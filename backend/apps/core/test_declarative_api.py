"""test_declarative_api.py: Pruebas de la API declarativa con monadas Result/Task.

Valida que Result[S, E], Task[S, E] y DeclarativeJobAPI funcionan
correctamente para consumo multicanal sin acoplamiento HTTP.
"""

from __future__ import annotations

from django.test import TestCase

from .types import DeferredTask, Failure, PureTask, Result, Success, Task


class ResultMonadTests(TestCase):
    """Pruebas del monad Result para manejo funcional de éxito/error."""

    def test_success_value_wrapped_and_retrieved(self) -> None:
        result: Result[int, str] = Success(42)
        self.assertTrue(result.is_success())
        self.assertFalse(result.is_failure())
        self.assertEqual(result.get_or_else(0), 42)

    def test_failure_value_wrapped_and_default_retrieved(self) -> None:
        result: Result[int, str] = Failure("error")
        self.assertFalse(result.is_success())
        self.assertTrue(result.is_failure())
        self.assertEqual(result.get_or_else(999), 999)

    def test_success_map_transforms_value(self) -> None:
        result: Result[int, str] = Success(5).map(lambda x: x * 2)
        self.assertEqual(result.get_or_else(0), 10)

    def test_success_map_chains(self) -> None:
        result: Result[str, str] = (
            Success(3).map(lambda x: x * 2).map(lambda x: f"result: {x}")
        )
        self.assertEqual(result.get_or_else(""), "result: 6")

    def test_failure_map_passes_through(self) -> None:
        result: Result[int, str] = Failure("error").map(lambda x: x * 2)
        self.assertFalse(result.is_success())
        self.assertTrue(result.is_failure())

    def test_success_flat_map_chains_results(self) -> None:
        def double_if_positive(x: int) -> Result[int, str]:
            if x > 0:
                return Success(x * 2)
            return Failure("negative")

        result: Result[int, str] = Success(5).flat_map(double_if_positive)
        self.assertEqual(result.get_or_else(0), 10)

    def test_success_recover_ignored(self) -> None:
        result: Result[int, str] = Success(42).recover(lambda err: 0)
        self.assertEqual(result.get_or_else(0), 42)

    def test_failure_recover_transforms_error_to_success(self) -> None:
        result: Result[int, str] = Failure("error").recover(lambda _: 99)
        self.assertEqual(result.get_or_else(0), 99)
        self.assertTrue(result.is_success())

    def test_fold_on_success(self) -> None:
        result = Success(5).fold(
            on_failure=lambda err: f"failed: {err}",
            on_success=lambda val: f"success: {val}",
        )
        self.assertEqual(result, "success: 5")

    def test_fold_on_failure(self) -> None:
        result = Failure("oops").fold(
            on_failure=lambda err: f"failed: {err}",
            on_success=lambda val: f"success: {val}",
        )
        self.assertEqual(result, "failed: oops")


class TaskMonadTests(TestCase):
    """Pruebas del monad Task para composición diferida."""

    def test_pure_task_runs_immediately(self) -> None:
        task: Task[int, str] = PureTask(Success(42))
        result = task.run()
        self.assertEqual(result.get_or_else(0), 42)

    def test_deferred_task_delays_execution(self) -> None:
        call_count = 0

        def computation() -> Result[int, str]:
            nonlocal call_count
            call_count += 1
            return Success(42)

        task: Task[int, str] = DeferredTask(computation)
        self.assertEqual(call_count, 0)  # No ejecutado aún
        result = task.run()
        self.assertEqual(call_count, 1)  # Ejecutado en run()
        self.assertEqual(result.get_or_else(0), 42)

    def test_task_map_chains_transformations(self) -> None:
        task: Task[str, str] = (
            PureTask(Success(5)).map(lambda x: x * 2).map(lambda x: f"result: {x}")
        )
        result = task.run()
        self.assertEqual(result.get_or_else(""), "result: 10")

    def test_task_flat_map_chains_tasks(self) -> None:
        def make_task(x: int) -> Task[int, str]:
            return PureTask(Success(x * 10))

        task: Task[int, str] = PureTask(Success(5)).flat_map(make_task)
        result = task.run()
        self.assertEqual(result.get_or_else(0), 50)

    def test_deferred_task_failure_propagates(self) -> None:
        def computation() -> Result[int, str]:
            return Failure("error during execution")

        task: Task[int, str] = DeferredTask(computation)
        result = task.run()
        self.assertTrue(result.is_failure())
