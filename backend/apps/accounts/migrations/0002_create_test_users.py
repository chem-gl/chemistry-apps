# Generated manually for test data setup
# Objetivo: Crear 3 usuarios de prueba con roles y grupos apropiados para testing multinivel

from django.contrib.auth.hashers import make_password
from django.db import migrations

# Contraseñas de desarrollo — NO usar en producción
_DEFAULT_PASSWORD = make_password("admin123")


def create_test_users(apps, schema_editor):
    """Crea 3 usuarios de prueba con roles multinivel y contraseñas usables."""
    _UserAccount = apps.get_model("accounts", "UserAccount")
    Group = apps.get_model("auth", "Group")

    # Crear grupos
    grupo_a, _ = Group.objects.get_or_create(name="Grupo A")
    grupo_b, _ = Group.objects.get_or_create(name="Grupo B")

    # 1. Usuario root (superusuario, contraseña: admin123)
    root_user, created = _UserAccount.objects.get_or_create(
        username="root",
        defaults={
            "email": "root@localhost",
            "password": _DEFAULT_PASSWORD,
            "is_superuser": True,
            "is_staff": True,
            "is_active": True,
            "role": "root",
            "account_status": "active",
            "email_verified": True,
        },
    )
    # Si el usuario ya existía, actualizar su contraseña para que sea usable
    if not created:
        root_user.password = _DEFAULT_PASSWORD
        root_user.save(update_fields=["password"])

    # 2. Usuario profesor (admin, contraseña: admin123)
    profesor_user, created = _UserAccount.objects.get_or_create(
        username="profesor",
        defaults={
            "email": "profesor@localhost",
            "password": _DEFAULT_PASSWORD,
            "is_superuser": False,
            "is_staff": True,  # Admins tienen is_staff=True
            "is_active": True,
            "role": "admin",
            "account_status": "active",
            "email_verified": True,
        },
    )
    if not created:
        profesor_user.password = _DEFAULT_PASSWORD
        profesor_user.save(update_fields=["password"])
    profesor_user.groups.add(grupo_a)

    # 3. Usuario alumno (user regular, contraseña: admin123)
    alumno_user, created = _UserAccount.objects.get_or_create(
        username="alumno",
        defaults={
            "email": "alumno@localhost",
            "password": _DEFAULT_PASSWORD,
            "is_superuser": False,
            "is_staff": False,  # Users regulares no tienen is_staff
            "is_active": True,
            "role": "user",
            "account_status": "active",
            "email_verified": True,
        },
    )
    if not created:
        alumno_user.password = _DEFAULT_PASSWORD
        alumno_user.save(update_fields=["password"])
    alumno_user.groups.add(grupo_a)


def reverse_create_test_users(apps, schema_editor):
    """Revierte la creación de usuarios de prueba."""
    UserAccount = apps.get_model("accounts", "UserAccount")
    Group = apps.get_model("auth", "Group")

    # Eliminar usuarios (aunque root no se elimina normalmente)
    UserAccount.objects.filter(username__in=["profesor", "alumno"]).delete()

    # Eliminar grupos
    Group.objects.filter(name__in=["Grupo A", "Grupo B"]).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(create_test_users, reverse_create_test_users),
    ]
