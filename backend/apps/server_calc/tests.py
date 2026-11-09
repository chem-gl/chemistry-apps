"""tests.py: Pruebas de contrato y ejecución para la app Server Calc.

Objetivo del archivo:
- Verificar creación/consulta de jobs y comportamiento del plugin con SSH
  simulado (sin red real): éxito remoto, fallo sin respaldo y validación.
- Verificar que solo root/admin pueden usar los endpoints (401 anónimo,
  403 usuario normal, 201 admin).

Cómo se usa:
- Ejecutar con `python manage.py test apps.server_calc`.
"""

from __future__ import annotations

import json
import subprocess
import uuid
from unittest.mock import Mock, patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import AbstractUser
from django.test import TestCase, override_settings
from rest_framework.response import Response
from rest_framework.test import APIClient, APIRequestFactory

from apps.core.identity.services.authorization_service import AuthorizationService
from apps.core.models import UserIdentityProfile
from apps.core.services import JobService
from apps.core.test_utils import build_authenticated_api_client
from apps.core.types import JSONMap

from . import plugin as plugin_module
from .definitions import APP_API_BASE_PATH, PLUGIN_NAME
from .plugin import _run_remote_calc, server_calc_plugin
from .routers import IsServerCalcAdmin, _identity_profile_for_request


def _silent_progress(_percent: int, _stage: str, _message: str) -> None:
    """Callback de progreso no-op para pruebas unitarias del plugin."""


def _silent_log(_level: str, _source: str, _message: str, _payload: object) -> None:
    """Callback de logs no-op para pruebas unitarias del plugin."""


def _remote_ok_stdout(
    a: float = 7.0, op: str = "*", b: float = 6.0, result: float = 42.0
) -> str:
    """Construye la salida JSON que emite calc.py en qta."""
    return json.dumps(
        {
            "ok": True,
            "a": a,
            "op": op,
            "b": b,
            "result": result,
            "job_id": "abcdef12",
            "file_name": "calc_abcdef12_20261001T000000.txt",
            "file_path": (
                "/home/chemistry-apps/server-apps/results/"
                "calc_abcdef12_20261001T000000.txt"
            ),
            "server": "qta",
        }
    )


@override_settings(QTA_SSH_HOST="qta.test.local")
class ServerCalcPluginUnitTests(TestCase):
    """Valida el plugin Server Calc con SSH simulado, sin red real."""

    def test_remote_success_returns_qta_result_with_file(self) -> None:
        """Con SSH OK, el resultado viene de qta con archivo reportado."""
        fake_completed = subprocess.CompletedProcess(
            args=["ssh"],
            returncode=0,
            stdout=_remote_ok_stdout(),
            stderr="",
        )
        progress_calls: list[tuple[int, str, str]] = []

        def _record_progress(percent: int, stage: str, message: str) -> None:
            progress_calls.append((percent, stage, message))

        with patch(
            "apps.server_calc.plugin.subprocess.run",
            return_value=fake_completed,
        ):
            result = server_calc_plugin(
                {"a": 7.0, "op": "*", "b": 6.0, "job_id": "abcdef123456"},
                _record_progress,
                _silent_log,
            )

        self.assertEqual(float(result["result"]), 42.0)
        self.assertEqual(str(result["op"]), "*")
        self.assertEqual(str(result["file_name"]), "calc_abcdef12_20261001T000000.txt")
        self.assertTrue(str(result["file_path"]).endswith(".txt"))
        metadata = result["metadata"]
        self.assertEqual(metadata["executed_on"], "qta")
        self.assertNotIn("fallback_used", metadata)
        self.assertEqual(progress_calls[-1][0], 100)

    def test_ssh_timeout_raises_without_fallback(self) -> None:
        """Si SSH expira, el job falla con error; no hay cálculo local."""
        with patch(
            "apps.server_calc.plugin.subprocess.run",
            side_effect=subprocess.TimeoutExpired(cmd="ssh", timeout=25),
        ):
            with self.assertRaises(ValueError) as error_context:
                server_calc_plugin(
                    {"a": 7.0, "op": "*", "b": 6.0},
                    _silent_progress,
                    _silent_log,
                )

        self.assertIn("qta", str(error_context.exception))

    def test_nonzero_exit_code_raises_without_fallback(self) -> None:
        """Un retorno SSH != 0 también falla el job (sin respaldo local)."""
        fake_completed = subprocess.CompletedProcess(
            args=["ssh"],
            returncode=255,
            stdout="",
            stderr="Connection refused",
        )
        with patch(
            "apps.server_calc.plugin.subprocess.run",
            return_value=fake_completed,
        ):
            with self.assertRaises(ValueError):
                server_calc_plugin(
                    {"a": 10.0, "op": "-", "b": 4.0},
                    _silent_progress,
                    _silent_log,
                )

    def test_invalid_operator_raises_value_error(self) -> None:
        """Un operador no soportado lanza ValueError sin intentar SSH."""
        with patch(
            "apps.server_calc.plugin.subprocess.run",
            side_effect=AssertionError("no debe llamarse a SSH"),
        ):
            with self.assertRaises(ValueError):
                server_calc_plugin(
                    {"a": 1.0, "op": "%", "b": 2.0},
                    _silent_progress,
                    _silent_log,
                )

    def test_division_by_zero_raises_value_error(self) -> None:
        """División por cero lanza ValueError sin intentar SSH."""
        with patch(
            "apps.server_calc.plugin.subprocess.run",
            side_effect=AssertionError("no debe llamarse a SSH"),
        ):
            with self.assertRaises(ValueError):
                server_calc_plugin(
                    {"a": 1.0, "op": "/", "b": 0.0},
                    _silent_progress,
                    _silent_log,
                )

    def test_non_numeric_a_raises_value_error(self) -> None:
        """Una `a` no numérica lanza ValueError sin intentar SSH."""
        with patch(
            "apps.server_calc.plugin.subprocess.run",
            side_effect=AssertionError("no debe llamarse a SSH"),
        ):
            with self.assertRaises(ValueError):
                server_calc_plugin(
                    {"a": "no-numérica", "op": "+", "b": 3.0},
                    _silent_progress,
                    _silent_log,
                )

    def test_run_remote_calc_builds_expected_ssh_command(self) -> None:
        """El runner SSH construye el comando esperado con job_label corto."""
        fake_completed = subprocess.CompletedProcess(
            args=["ssh"],
            returncode=0,
            stdout=_remote_ok_stdout(),
            stderr="",
        )
        with patch(
            "apps.server_calc.plugin.subprocess.run",
            return_value=fake_completed,
        ) as run_mock:
            payload = _run_remote_calc(
                7.0, "*", 6.0, "abcd1234", "qta-host", "qta-user", "/tmp/key", 25
            )

        self.assertEqual(payload["result"], 42.0)
        invoked_args: list[str] = run_mock.call_args[0][0]
        self.assertEqual(invoked_args[0], "ssh")
        self.assertIn("qta-user@qta-host", invoked_args)
        self.assertIn("/home/chemistry-apps/server-apps/calc.py", invoked_args)
        self.assertIn("'*'", invoked_args)
        self.assertIn("abcd1234", invoked_args)

    def test_run_remote_calc_verifies_host_key_with_dedicated_known_hosts(
        self,
    ) -> None:
        """SSH verifica la host key (accept-new) con known_hosts dedicado."""
        fake_completed = subprocess.CompletedProcess(
            args=["ssh"],
            returncode=0,
            stdout=_remote_ok_stdout(),
            stderr="",
        )
        with patch(
            "apps.server_calc.plugin.subprocess.run",
            return_value=fake_completed,
        ) as run_mock:
            _run_remote_calc(
                7.0,
                "*",
                6.0,
                "abcd1234",
                "qta-host",
                "qta-user",
                "/tmp/key",
                25,
                "/tmp/qta_known_hosts",
            )

        invoked_args: list[str] = run_mock.call_args[0][0]
        options = [
            invoked_args[index + 1]
            for index, token in enumerate(invoked_args)
            if token == "-o"
        ]
        self.assertIn("StrictHostKeyChecking=accept-new", options)
        self.assertIn("UserKnownHostsFile=/tmp/qta_known_hosts", options)
        self.assertIn("BatchMode=yes", options)
        self.assertIn("IdentitiesOnly=yes", options)
        self.assertIn("ConnectTimeout=25", options)
        self.assertFalse(any("StrictHostKeyChecking=no" == opt for opt in options))
        self.assertFalse(any("/dev/null" in opt for opt in options))

    @override_settings(QTA_SSH_KNOWN_HOSTS_PATH="/tmp/settings_known_hosts")
    def test_plugin_uses_known_hosts_path_from_settings(self) -> None:
        """El plugin pasa QTA_SSH_KNOWN_HOSTS_PATH de settings a ssh."""
        fake_completed = subprocess.CompletedProcess(
            args=["ssh"],
            returncode=0,
            stdout=_remote_ok_stdout(),
            stderr="",
        )
        with patch(
            "apps.server_calc.plugin.subprocess.run",
            return_value=fake_completed,
        ) as run_mock:
            server_calc_plugin(
                {"a": 7.0, "op": "*", "b": 6.0}, _silent_progress, _silent_log
            )

        invoked_args: list[str] = run_mock.call_args[0][0]
        self.assertIn("UserKnownHostsFile=/tmp/settings_known_hosts", invoked_args)
        self.assertIn("StrictHostKeyChecking=accept-new", invoked_args)

    def test_plugin_falla_sin_qta_ssh_host_configurado(self) -> None:
        """Sin destino configurado el plugin falla antes de invocar `ssh`.

        `QTA_SSH_HOST` dejó de tener default en settings y el plugin tampoco puede
        reintroducir una IP de red local: vaciar la variable debe producir un
        error claro, no una conexión contra un host arbitrario.
        """
        for unconfigured_host in ("", "   ", None):
            with self.subTest(qta_ssh_host=unconfigured_host):
                with override_settings(QTA_SSH_HOST=unconfigured_host):
                    with patch(
                        "apps.server_calc.plugin.subprocess.run",
                        side_effect=AssertionError("no debe llamarse a SSH"),
                    ):
                        with self.assertRaises(ValueError) as error_context:
                            server_calc_plugin(
                                {"a": 7.0, "op": "*", "b": 6.0},
                                _silent_progress,
                                _silent_log,
                            )

                self.assertIn("QTA_SSH_HOST", str(error_context.exception))

    def test_el_plugin_no_reintroduce_un_host_por_defecto(self) -> None:
        """El módulo del plugin no define una IP fija como destino de qta."""
        self.assertNotIn("DEFAULT_QTA_SSH_HOST", vars(plugin_module))


@override_settings(QTA_SSH_HOST="qta.test.local")
class ServerCalcContractApiTests(TestCase):
    """Valida contrato HTTP y ejecución del plugin Server Calc."""

    def setUp(self) -> None:
        self.client = build_authenticated_api_client()

    def test_create_and_retrieve_server_calc_job(self) -> None:
        request_payload: JSONMap = {
            "version": "1.2.0",
            "a": 7.0,
            "op": "*",
            "b": 6.0,
        }

        with patch("apps.server_calc.routers.dispatch_scientific_job") as dispatch_mock:
            dispatch_mock.return_value = True
            create_response = self.client.post(
                APP_API_BASE_PATH,
                request_payload,
                format="json",
            )

        self.assertEqual(create_response.status_code, 201)
        self.assertEqual(create_response.data["plugin_name"], PLUGIN_NAME)
        self.assertEqual(create_response.data["parameters"]["op"], "*")
        created_job_id: str = str(create_response.data["id"])

        fake_completed = subprocess.CompletedProcess(
            args=["ssh"],
            returncode=0,
            stdout=_remote_ok_stdout(7.0, "*", 6.0, 42.0),
            stderr="",
        )
        with patch(
            "apps.server_calc.plugin.subprocess.run",
            return_value=fake_completed,
        ):
            JobService.run_job(created_job_id)

        retrieve_response = self.client.get(f"{APP_API_BASE_PATH}{created_job_id}/")
        self.assertEqual(retrieve_response.status_code, 200)
        self.assertEqual(retrieve_response.data["status"], "completed")

        result_payload: dict[str, object] = retrieve_response.data["results"]
        self.assertEqual(float(result_payload["result"]), 42.0)
        self.assertEqual(str(result_payload["file_name"]).endswith(".txt"), True)
        metadata_payload: dict[str, object] = result_payload["metadata"]  # type: ignore[assignment]
        self.assertEqual(metadata_payload["executed_on"], "qta")

    def test_ssh_failure_marks_job_failed(self) -> None:
        """Sin conexión a qta el job queda failed, sin resultado de respaldo."""
        with patch("apps.server_calc.routers.dispatch_scientific_job") as dispatch_mock:
            dispatch_mock.return_value = True
            create_response = self.client.post(
                APP_API_BASE_PATH,
                {"version": "1.2.0", "a": 7.0, "op": "*", "b": 6.0},
                format="json",
            )
        created_job_id: str = str(create_response.data["id"])

        with patch(
            "apps.server_calc.plugin.subprocess.run",
            side_effect=subprocess.TimeoutExpired(cmd="ssh", timeout=25),
        ):
            JobService.run_job(created_job_id)

        retrieve_response = self.client.get(f"{APP_API_BASE_PATH}{created_job_id}/")
        self.assertEqual(retrieve_response.status_code, 200)
        self.assertEqual(retrieve_response.data["status"], "failed")
        self.assertIn("qta", str(retrieve_response.data["error_trace"]))

    def test_create_rejects_division_by_zero(self) -> None:
        """POST con b=0 y op=/ responde 400 sin encolar."""
        with patch("apps.server_calc.routers.dispatch_scientific_job") as dispatch_mock:
            response = self.client.post(
                APP_API_BASE_PATH,
                {"version": "1.2.0", "a": 1.0, "op": "/", "b": 0.0},
                format="json",
            )
        self.assertEqual(response.status_code, 400)
        dispatch_mock.assert_not_called()

    def test_report_csv_returns_download_for_completed_server_calc_job(self) -> None:
        from apps.core.models import ScientificJob

        completed_job: ScientificJob = ScientificJob.objects.create(
            plugin_name=PLUGIN_NAME,
            algorithm_version="1.2.0",
            job_hash="s" * 64,
            parameters={"a": 7.0, "op": "*", "b": 6.0},
            status="completed",
            cache_hit=False,
            cache_miss=True,
            results={
                "a": 7.0,
                "op": "*",
                "b": 6.0,
                "result": 42.0,
                "file_name": "calc_x.txt",
                "file_path": "/home/chemistry-apps/server-apps/results/calc_x.txt",
                "metadata": {
                    "executed_on": "qta",
                    "remote_host": "qta.test.local",
                },
            },
        )

        response = self.client.get(f"{APP_API_BASE_PATH}{completed_job.id}/report-csv/")

        self.assertEqual(response.status_code, 200)
        self.assertIn("text/csv", str(response["Content-Type"]))
        csv_content: str = response.content.decode("utf-8")
        self.assertIn("a,op,b,result,executed_on,file_name,file_path", csv_content)
        self.assertIn("calc_x.txt", csv_content)


class ServerCalcAdminPermissionTests(TestCase):
    """Solo root/admin pueden usar Server Calc (anon 401, normal 403)."""

    def _regular_client(self) -> APIClient:
        user_model = get_user_model()
        username = f"regular-{uuid.uuid4().hex[:8]}"
        user = user_model.objects.create_user(
            username=username,
            email=f"{username}@example.com",
            password=None,
            is_staff=False,
            is_superuser=False,
        )
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    def test_anonymous_create_is_unauthorized(self) -> None:
        """Sin sesión, POST responde 401."""
        response = APIClient().post(
            APP_API_BASE_PATH,
            {"version": "1.2.0", "a": 1.0, "op": "+", "b": 2.0},
            format="json",
        )
        self.assertEqual(response.status_code, 401)

    def test_regular_user_create_is_forbidden(self) -> None:
        """Usuario no admin recibe 403 al crear."""
        response = self._regular_client().post(
            APP_API_BASE_PATH,
            {"version": "1.2.0", "a": 1.0, "op": "+", "b": 2.0},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_admin_create_is_allowed(self) -> None:
        """Admin (superusuario de pruebas) recibe 201."""
        with patch("apps.server_calc.routers.dispatch_scientific_job") as dispatch_mock:
            dispatch_mock.return_value = True
            response = build_authenticated_api_client().post(
                APP_API_BASE_PATH,
                {"version": "1.2.0", "a": 1.0, "op": "+", "b": 2.0},
                format="json",
            )
        self.assertEqual(response.status_code, 201)

    def _create_response(self, client: APIClient) -> Response:
        """Intenta crear un job de Server Calc con el cliente dado."""
        with patch("apps.server_calc.routers.dispatch_scientific_job") as dispatch_mock:
            dispatch_mock.return_value = True
            return client.post(
                APP_API_BASE_PATH,
                {"version": "1.2.0", "a": 1.0, "op": "+", "b": 2.0},
                format="json",
            )

    def _client_for_user(
        self, *, is_staff: bool = False
    ) -> tuple[APIClient, AbstractUser]:
        """Crea usuario (opcionalmente staff) y devuelve cliente autenticado."""
        user_model = get_user_model()
        username = f"perm-{uuid.uuid4().hex[:8]}"
        user = user_model.objects.create_user(
            username=username,
            email=f"{username}@example.com",
            password=None,
            is_staff=is_staff,
            is_superuser=False,
        )
        client = APIClient()
        client.force_authenticate(user=user)
        return client, user

    def test_root_superuser_create_is_allowed(self) -> None:
        """Root (superusuario) recibe 201."""
        user_model = get_user_model()
        root = user_model.objects.create_user(
            username=f"root-{uuid.uuid4().hex[:8]}",
            email=f"root-{uuid.uuid4().hex[:8]}@example.com",
            password=None,
            is_staff=True,
            is_superuser=True,
        )
        client = APIClient()
        client.force_authenticate(user=root)
        self.assertEqual(self._create_response(client).status_code, 201)

    def test_staff_without_admin_role_is_forbidden(self) -> None:
        """is_staff sin rol admin ni grupo qta recibe 403 (is_staff no da acceso)."""
        client, user = self._client_for_user()
        # Simula que la API de identidad fijó is_staff sin otorgar rol admin:
        # update() evita el save() que promueve is_staff a rol admin.
        user_model = get_user_model()
        user_model.objects.filter(pk=user.pk).update(is_staff=True)
        user.refresh_from_db()
        self.assertTrue(user.is_staff)
        self.assertEqual(self._create_response(client).status_code, 403)

    def test_explicit_admin_role_create_is_allowed(self) -> None:
        """Usuario con rol admin explícito en el perfil recibe 201."""
        from apps.core.models import UserIdentityProfile

        client, user = self._client_for_user()
        UserIdentityProfile.objects.update_or_create(
            user=user, defaults={"role": "admin"}
        )
        self.assertEqual(self._create_response(client).status_code, 201)

    def test_user_without_group_is_forbidden(self) -> None:
        """Usuario normal sin membresía qta-operators recibe 403."""
        client, _ = self._client_for_user()
        self.assertEqual(self._create_response(client).status_code, 403)

    def test_qta_operator_member_create_is_allowed(self) -> None:
        """Miembro de qta-operators con server-calc habilitado recibe 201."""
        from apps.core.models import GroupMembership, WorkGroup

        from .bootstrap_qta import ensure_qta_operators_group

        ensure_qta_operators_group()
        group = WorkGroup.objects.get(slug="qta-operators")
        client, user = self._client_for_user()
        GroupMembership.objects.create(
            user=user, group=group, role_in_group=GroupMembership.ROLE_MEMBER
        )
        self.assertEqual(self._create_response(client).status_code, 201)

    def test_qta_operator_with_disabled_permission_is_forbidden(self) -> None:
        """Miembro de qta-operators sin permiso server-calc habilitado: 403."""
        from apps.core.models import AppPermission, GroupMembership, WorkGroup

        from .bootstrap_qta import ensure_qta_operators_group

        ensure_qta_operators_group()
        group = WorkGroup.objects.get(slug="qta-operators")
        AppPermission.objects.filter(app_name=PLUGIN_NAME, group=group).update(
            is_enabled=False
        )
        client, user = self._client_for_user()
        GroupMembership.objects.create(
            user=user, group=group, role_in_group=GroupMembership.ROLE_MEMBER
        )
        self.assertEqual(self._create_response(client).status_code, 403)

    def test_non_member_of_other_group_is_forbidden(self) -> None:
        """Membresía en otro grupo no concede acceso a Server Calc."""
        from apps.core.models import GroupMembership, WorkGroup

        from .bootstrap_qta import ensure_qta_operators_group

        ensure_qta_operators_group()
        other_group = WorkGroup.objects.create(
            name="Otro grupo", slug="otro-grupo-perm-test"
        )
        client, user = self._client_for_user()
        GroupMembership.objects.create(
            user=user, group=other_group, role_in_group=GroupMembership.ROLE_MEMBER
        )
        self.assertEqual(self._create_response(client).status_code, 403)


class ServerCalcPermissionProfileCacheTests(TestCase):
    """`IsServerCalcAdmin` resuelve el perfil de identidad una vez por request."""

    def _actor(self, label: str) -> AbstractUser:
        user_model = get_user_model()
        return user_model.objects.create_user(
            username=f"profile-{label}-{uuid.uuid4().hex[:6]}",
            email=f"profile-{label}@example.com",
            password=None,
            is_staff=False,
            is_superuser=False,
        )

    @patch("apps.server_calc.routers.AuthorizationService.resolve_identity_profile")
    def test_el_perfil_se_memoiza_en_la_request(
        self, mocked_resolve_profile: Mock
    ) -> None:
        """Dos lecturas del mismo actor en una request cuestan una sola consulta."""
        mocked_resolve_profile.return_value = None

        request = APIRequestFactory().post("/")
        actor = self._actor("memo")

        first = _identity_profile_for_request(request, actor)
        second = _identity_profile_for_request(request, actor)

        self.assertIsNone(first)
        self.assertIs(second, first)
        mocked_resolve_profile.assert_called_once_with(actor)

    @patch(
        "apps.core.identity.services.authorization_service."
        "AuthorizationService._get_identity_profile"
    )
    def test_is_root_usa_el_perfil_ya_resuelto(self, mocked_get_profile: Mock) -> None:
        """`is_root` consume el perfil recibido y no vuelve a la BD por él."""
        actor = self._actor("root-profile")
        root_profile = UserIdentityProfile(user=actor, role="root")

        self.assertTrue(AuthorizationService.is_root(actor, profile=root_profile))
        mocked_get_profile.assert_not_called()

    @patch(
        "apps.core.identity.services.authorization_service."
        "AuthorizationService._get_identity_profile"
    )
    def test_has_explicit_admin_role_usa_el_perfil_ya_resuelto(
        self, mocked_get_profile: Mock
    ) -> None:
        """`has_explicit_admin_role` también consume el perfil memoizado."""
        actor = self._actor("admin-profile")
        admin_profile = UserIdentityProfile(user=actor, role="admin")

        self.assertTrue(
            AuthorizationService.has_explicit_admin_role(actor, profile=admin_profile)
        )
        mocked_get_profile.assert_not_called()

    def test_actor_sin_perfil_de_identidad_no_es_root(self) -> None:
        """Sin perfil en BD (y sin perfil explícito), la decisión sigue siendo no-root."""
        actor = self._actor("sin-perfil")

        self.assertFalse(AuthorizationService.is_root(actor))
        self.assertFalse(AuthorizationService.has_explicit_admin_role(actor))

    def test_permiso_sigue_denegando_a_usuario_normal(self) -> None:
        """La memoización no cambia la decisión: sin membresía, 403."""
        actor = self._actor("denied")
        request = APIRequestFactory().post("/")
        request.user = actor

        self.assertFalse(IsServerCalcAdmin().has_permission(request, view=object()))


class ServerCalcContractTests(TestCase):
    """Valida que el contrato declarativo expone la interfaz esperada."""

    def test_contract_exposes_required_interface(self) -> None:
        """El contrato debe tener plugin_name, execute y supports_pause_resume."""
        from .contract import get_server_calc_contract

        contract = get_server_calc_contract()
        for key in ("plugin_name", "version", "execute", "supports_pause_resume"):
            self.assertIn(key, contract)
        self.assertIsNotNone(contract["execute"])


class ServerCalcBootstrapTests(TestCase):
    """Valida el grupo qta-operators con acceso a Server Calc."""

    def test_ensure_qta_operators_group_is_idempotent(self) -> None:
        """Crea grupo + permiso + membresía root; re-ejecutar no duplica."""
        from apps.core.models import AppPermission, GroupMembership, WorkGroup

        from .bootstrap_qta import ensure_qta_operators_group

        group, _ = ensure_qta_operators_group()
        assert group is not None
        group_again, created_again = ensure_qta_operators_group()

        self.assertEqual(group.pk, group_again.pk)
        self.assertFalse(created_again)
        self.assertEqual(group.slug, "qta-operators")
        self.assertTrue(
            AppPermission.objects.filter(
                app_name=PLUGIN_NAME, group=group, is_enabled=True
            ).exists()
        )
        self.assertEqual(WorkGroup.objects.filter(slug="qta-operators").count(), 1)
        self.assertTrue(
            GroupMembership.objects.filter(group=group, role_in_group="admin").exists()
        )
