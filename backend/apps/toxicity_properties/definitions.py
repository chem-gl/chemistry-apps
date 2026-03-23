"""definitions.py: Constantes de identidad y operación de Toxicity Properties.

Centraliza nombres de app/plugin, prefijos de ruta y parámetros operativos
para evitar valores hardcodeados en router, plugin y contratos.
"""

from typing import Final

APP_CONFIG_NAME: Final[str] = "apps.toxicity_properties"
APP_ROUTE_PREFIX: Final[str] = "toxicity-properties/jobs"
APP_ROUTE_BASENAME: Final[str] = "toxicity-properties-job"
APP_API_BASE_PATH: Final[str] = "/api/toxicity-properties/jobs/"

PLUGIN_NAME: Final[str] = "toxicity-properties"
DEFAULT_ALGORITHM_VERSION: Final[str] = "1.0.0"

# Procesamiento interno por bloques para soportar lotes grandes
# sin imponer límite de negocio a nivel de API.
INFERENCE_CHUNK_SIZE: Final[int] = 64

AMES_POSITIVE_THRESHOLD: Final[float] = 0.5
DEVTOX_POSITIVE_THRESHOLD: Final[float] = 0.7

SCIENTIFIC_REFERENCES: Final[tuple[str, ...]] = (
    (
        "Swanson, K., Walther, P., Leitz, J., Mukherjee, S., Wu, J. C., "
        "Shivnaraine, R. V., & Zou, J. (2024). ADMET-AI: A machine learning "
        "ADMET platform for evaluation of large-scale chemical libraries. "
        "Bioinformatics, 40(7), btae416."
    ),
    (
        "Huang, K., Fu, T., Gao, W., Zhao, Y., Roohani, Y., Leskovec, J., "
        "Coley, C. W., Xiao, C., Sun, J., & Zitnik, M. (2022). Artificial "
        "intelligence foundation for therapeutic science. Nature Chemical "
        "Biology, 18(10), 1033-1036."
    ),
    (
        "Zhang, J., Li, H., Zhang, Y., et al. (2025). Computational toxicology "
        "in drug discovery: applications of artificial intelligence in ADMET "
        "prediction. Briefings in Bioinformatics, 26(5)."
    ),
)
