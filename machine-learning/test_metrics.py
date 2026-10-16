import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import orjson
import pytest
from fastapi.testclient import TestClient
from pytest import MonkeyPatch
from pytest_mock import MockerFixture

from immich_ml.main import load
from immich_ml.models.base import InferenceModel
from immich_ml.models.cache import ModelCache
from immich_ml.models.clip.visual import OpenClipVisualEncoder
from immich_ml.schemas import ModelTask, ModelType


class TestPrometheusMetrics:
    def test_metrics_endpoint_returns_prometheus_text(self, deployed_app: TestClient) -> None:
        from immich_ml.metrics import reset_metrics_for_tests

        reset_metrics_for_tests()
        response = deployed_app.get("/metrics")

        assert response.status_code == 200
        assert "text/plain" in response.headers["content-type"]
        assert "immich_ml_active_requests" in response.text

    def test_predict_records_success_metrics(self, deployed_app: TestClient, mocker: MockerFixture) -> None:
        from immich_ml.metrics import reset_metrics_for_tests

        reset_metrics_for_tests()
        mocker.patch("immich_ml.main.run_inference", new_callable=mock.AsyncMock, return_value={"clip": "embedding"})
        entries = {"clip": {"textual": {"modelName": "ViT-B-32__openai"}}}

        response = deployed_app.post("/predict", data={"entries": orjson.dumps(entries).decode(), "text": "hello"})
        metrics = deployed_app.get("/metrics").text

        assert response.status_code == 200
        assert 'immich_ml_requests_total{status="success",task="clip",type="textual"} 1.0' in metrics
        assert 'immich_ml_request_duration_ms_count{status="success",task="clip",type="textual"} 1.0' in metrics
        assert "immich_ml_active_requests 0.0" in metrics

    def test_predict_records_http_error_metrics(self, deployed_app: TestClient) -> None:
        from immich_ml.metrics import reset_metrics_for_tests

        reset_metrics_for_tests()
        entries = {"clip": {"textual": {"modelName": "ViT-B-32__openai"}}}

        response = deployed_app.post("/predict", data={"entries": orjson.dumps(entries).decode()})
        metrics = deployed_app.get("/metrics").text

        assert response.status_code == 400
        assert 'immich_ml_requests_total{status="error",task="clip",type="textual"} 1.0' in metrics
        assert 'immich_ml_request_duration_ms_count{status="error",task="clip",type="textual"} 1.0' in metrics
        assert 'status="success"' not in metrics

    def test_predict_records_unhandled_error_metrics(self, deployed_app: TestClient, mocker: MockerFixture) -> None:
        from immich_ml.metrics import reset_metrics_for_tests

        reset_metrics_for_tests()
        mocker.patch("immich_ml.main.run_inference", new_callable=mock.AsyncMock, side_effect=RuntimeError("boom"))
        entries = {"clip": {"textual": {"modelName": "ViT-B-32__openai"}}}

        with pytest.raises(RuntimeError):
            deployed_app.post("/predict", data={"entries": orjson.dumps(entries).decode(), "text": "hello"})
        metrics = deployed_app.get("/metrics").text

        assert 'immich_ml_requests_total{status="error",task="clip",type="textual"} 1.0' in metrics
        assert 'status="success"' not in metrics
        assert "immich_ml_active_requests 0.0" in metrics

    def test_predict_records_validation_failure_with_unknown_labels(self, deployed_app: TestClient) -> None:
        from immich_ml.metrics import reset_metrics_for_tests

        reset_metrics_for_tests()

        response = deployed_app.post("/predict", data={"entries": "{", "text": "hello"})
        metrics = deployed_app.get("/metrics").text

        assert response.status_code == 422
        assert 'immich_ml_requests_total{status="validation_error",task="unknown",type="unknown"} 1.0' in metrics

    def test_predict_input_validation_failure_records_no_metric(self, deployed_app: TestClient) -> None:
        from immich_ml.metrics import reset_metrics_for_tests

        reset_metrics_for_tests()
        entries = {"clip": {"textual": {"modelName": "ViT-B-32__openai"}}}

        # `text` sent as a file part fails FastAPI's own validation after the entries dependency resolved
        response = deployed_app.post(
            "/predict", data={"entries": orjson.dumps(entries).decode()}, files={"text": ("t.txt", b"hello")}
        )
        metrics = deployed_app.get("/metrics").text

        assert response.status_code == 422
        assert "immich_ml_requests_total{" not in metrics

    def test_render_aggregates_multiprocess_metrics(self, tmp_path: Path) -> None:
        record_script = """
from immich_ml import metrics
metrics.REQUESTS.labels(task="clip", type="textual", status="success").inc()
"""
        render_script = """
from immich_ml import metrics
print(metrics.render().decode())
"""
        env = {**os.environ, "PROMETHEUS_MULTIPROC_DIR": tmp_path.as_posix()}

        subprocess.run([sys.executable, "-c", record_script], check=True, env=env)
        subprocess.run([sys.executable, "-c", record_script], check=True, env=env)
        result = subprocess.run(
            [sys.executable, "-c", render_script],
            capture_output=True,
            check=True,
            env=env,
            text=True,
        )

        assert 'immich_ml_requests_total{status="success",task="clip",type="textual"} 2.0' in result.stdout

    def test_model_cache_entries_zeroes_removed_labels(self) -> None:
        from immich_ml import metrics

        metrics.reset_metrics_for_tests()
        metrics.set_model_cache_entries([("clip", "visual")])
        metrics.set_model_cache_entries([])

        rendered = metrics.render().decode()

        assert 'immich_ml_model_cache_entries{task="clip",type="visual"} 0.0' in rendered

    def test_prepare_prometheus_multiprocess_dir_cleans_stale_files(
        self, tmp_path: Path, monkeypatch: MonkeyPatch
    ) -> None:
        from immich_ml.prometheus import prepare_prometheus_multiprocess_dir

        stale_file = tmp_path / "counter_123.db"
        unrelated_file = tmp_path / "keep.txt"
        stale_file.write_text("stale")
        unrelated_file.write_text("keep")
        monkeypatch.setenv("PROMETHEUS_MULTIPROC_DIR", tmp_path.as_posix())

        result = prepare_prometheus_multiprocess_dir()

        assert result == tmp_path
        assert os.environ["PROMETHEUS_MULTIPROC_DIR"] == tmp_path.as_posix()
        assert not stale_file.exists()
        assert unrelated_file.exists()

    def test_gunicorn_child_exit_marks_worker_dead(self, mocker: MockerFixture) -> None:
        from immich_ml import gunicorn_conf

        mark_process_dead = mocker.patch("immich_ml.gunicorn_conf.multiprocess.mark_process_dead")

        gunicorn_conf.child_exit(mock.Mock(), SimpleNamespace(pid=1234))

        mark_process_dead.assert_called_once_with(1234)

    def test_refresh_model_cache_metrics_counts_cached_models(self, monkeypatch: MonkeyPatch) -> None:
        from immich_ml import metrics
        from immich_ml.main import refresh_model_cache_metrics

        metrics.reset_metrics_for_tests()
        mock_model = mock.Mock(spec=InferenceModel)
        mock_model.model_task = ModelTask.SEARCH
        mock_model.model_type = ModelType.VISUAL
        # a real ModelCache, so a rename of the attribute the refresh reads fails here rather than on /metrics
        cache = ModelCache()
        cache._models[(OpenClipVisualEncoder, "ViT-B-32__openai", None)] = mock_model
        monkeypatch.setattr("immich_ml.main.model_cache", cache)

        refresh_model_cache_metrics()
        rendered = metrics.render().decode()

        assert 'immich_ml_model_cache_entries{task="clip",type="visual"} 1.0' in rendered

    @pytest.mark.asyncio
    async def test_model_load_records_success_and_retry_metrics(self, deployed_app: TestClient) -> None:
        from immich_ml.metrics import reset_metrics_for_tests

        reset_metrics_for_tests()
        mock_model = mock.Mock(spec=InferenceModel)
        mock_model.model_name = "test_model_name"
        mock_model.model_type = ModelType.VISUAL
        mock_model.model_task = ModelTask.SEARCH
        mock_model.load.side_effect = [OSError, None]
        mock_model.loaded = False
        mock_model.load_attempts = 0

        await load(mock_model)
        metrics = deployed_app.get("/metrics").text

        assert 'immich_ml_model_load_duration_ms_count{status="error",task="clip",type="visual"} 1.0' in metrics
        assert 'immich_ml_model_load_duration_ms_count{status="success",task="clip",type="visual"} 1.0' in metrics
