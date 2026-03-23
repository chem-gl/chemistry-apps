"""__init__.py: Punto de entrada de la librería local para ADMET-AI.

Expone un cliente tipado que encapsula la carga perezosa del modelo
ADMET-AI y estandariza respuestas para uso en plugins científicos.
"""

from .client import AdmetAiClient
from .models import AdmetPredictionResult

__all__: list[str] = ["AdmetAiClient", "AdmetPredictionResult"]
