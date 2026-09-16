"""Tests del mixin común de routers científicos."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from django.test import RequestFactory, TestCase
from rest_framework import serializers, status

from apps.core.base_router import ScientificAppViewSetMixin
from apps.core.models import ScientificJob
from apps.core.types import Failure, Success


class _JobSerializer(serializers.ModelSerializer):
    class Meta:
        model = ScientificJob
        fields = ("id", "plugin_name", "status")


class _Router(ScientificAppViewSetMixin):
    plugin_name = "test-plugin"
    response_serializer_class = _JobSerializer

    def build_csv_content(self, job: ScientificJob) -> str:
        return f"job,{job.id}"


def _job(**kwargs: object) -> ScientificJob:
    defaults: dict[str, object] = {
        "plugin_name": "test-plugin",
        "algorithm_version": "1.0.0",
        "job_hash": "base-router-hash",
        "parameters": {},
        "status": "completed",
        "results": {"ok": True},
    }
    defaults.update(kwargs)
    return ScientificJob.objects.create(**defaults)


class ScientificAppViewSetMixinTests(TestCase):
    def setUp(self) -> None:
        self.router = _Router()
        self.factory = RequestFactory()

    def test_build_csv_content_requires_override(self) -> None:
        mixin = ScientificAppViewSetMixin()
        with self.assertRaises(NotImplementedError):
            mixin.build_csv_content(MagicMock())

    def test_retrieve_returns_serialized_job(self) -> None:
        job = _job()
        self.router.request = self.factory.get("/")
        response = self.router.retrieve(self.router.request, id=str(job.id))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(str(response.data["id"]), str(job.id))

    def test_report_csv_rejects_non_completed_job(self) -> None:
        job = _job(status="running", job_hash="running-hash")
        self.router.request = self.factory.get("/")
        response = self.router.report_csv(self.router.request, id=str(job.id))
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)

    def test_report_csv_returns_download(self) -> None:
        job = _job(job_hash="csv-hash")
        self.router.request = self.factory.get("/")
        response = self.router.report_csv(self.router.request, id=str(job.id))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response["Content-Type"], "text/csv; charset=utf-8")
        self.assertIn("job,", response.content.decode())

    def test_report_error_conflicts_without_error_trace(self) -> None:
        job = _job(status="completed", job_hash="no-error-hash")
        self.router.request = self.factory.get("/")
        response = self.router.report_error(self.router.request, id=str(job.id))
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)

    def test_handle_submit_result_maps_failure_to_503(self) -> None:
        response = self.router.handle_submit_result(Failure("broker down"), _JobSerializer)
        self.assertEqual(response.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)
        self.assertEqual(response.data["detail"], "broker down")

    def test_handle_submit_result_maps_missing_handle_to_503(self) -> None:
        result = MagicMock()
        result.is_failure.return_value = False
        result.get_or_else.return_value = None
        response = self.router.handle_submit_result(result, _JobSerializer)
        self.assertEqual(response.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)

    def test_handle_submit_result_serializes_successful_job(self) -> None:
        job = _job(job_hash="success-hash")
        handle = MagicMock(job_id=str(job.id))
        response = self.router.handle_submit_result(Success(handle), _JobSerializer)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(str(response.data["id"]), str(job.id))

    @patch("apps.core.base_router.ScientificInputArtifactStorageService")
    def test_persist_artifacts_marks_job_failed_when_storage_errors(
        self, storage_class: MagicMock
    ) -> None:
        job = _job(status="pending", job_hash="artifact-error-hash")
        storage_class.return_value.store_uploaded_file.side_effect = OSError("disk")
        response = self.router.persist_artifacts_and_finalize(
            job, [("input", MagicMock())], MagicMock(), final_action="dispatch"
        )
        self.assertIsNotNone(response)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        job.refresh_from_db()
        self.assertEqual(job.status, "failed")
        self.assertEqual(job.progress_stage, "failed")

    @patch("apps.core.base_router.broadcast_job_update")
    def test_persist_artifacts_pause_updates_job_without_dispatch(
        self, broadcast: MagicMock
    ) -> None:
        job = _job(status="pending", job_hash="pause-hash")
        storage = MagicMock()
        with patch("apps.core.base_router.ScientificInputArtifactStorageService", return_value=storage):
            result = self.router.persist_artifacts_and_finalize(
                job, [], MagicMock(), final_action="pause"
            )
        self.assertIsNone(result)
        job.refresh_from_db()
        self.assertEqual(job.status, "paused")
        broadcast.assert_called_once()
