"""
# urls.py

Enrutamiento principal del backend y exposición de OpenAPI.
"""

from apps.core.definitions import CORE_JOBS_ROUTE_BASENAME, CORE_JOBS_ROUTE_PREFIX
from apps.core.identity.routers import (
    AppPermissionDetailView,
    AppPermissionsView,
    CurrentUserAccessibleAppsView,
    CurrentUserAppConfigView,
    CurrentUserProfileView,
    DomainTokenObtainPairView,
    DomainTokenRefreshView,
    GroupAppConfigDetailView,
    GroupMembershipDetailView,
    GroupMembershipsView,
    IdentityUserDetailView,
    IdentityUsersView,
    ScientificAppCatalogView,
    WorkGroupDetailView,
    WorkGroupsView,
)
from apps.core.routers import JobViewSet
from apps.easy_rate.definitions import APP_ROUTE_BASENAME as EASY_RATE_ROUTE_BASENAME
from apps.easy_rate.definitions import APP_ROUTE_PREFIX as EASY_RATE_ROUTE_PREFIX
from apps.easy_rate.routers import EasyRateJobViewSet
from apps.marcus.definitions import APP_ROUTE_BASENAME as MARCUS_ROUTE_BASENAME
from apps.marcus.definitions import APP_ROUTE_PREFIX as MARCUS_ROUTE_PREFIX
from apps.marcus.routers import MarcusJobViewSet
from apps.molar_fractions.definitions import (
    APP_ROUTE_BASENAME as MOLAR_FRACTIONS_ROUTE_BASENAME,
)
from apps.molar_fractions.definitions import (
    APP_ROUTE_PREFIX as MOLAR_FRACTIONS_ROUTE_PREFIX,
)
from apps.molar_fractions.routers import MolarFractionsJobViewSet
from apps.sa_score.definitions import APP_ROUTE_BASENAME as SA_SCORE_ROUTE_BASENAME
from apps.sa_score.definitions import APP_ROUTE_PREFIX as SA_SCORE_ROUTE_PREFIX
from apps.sa_score.routers import SaScoreJobViewSet
from apps.smileit.definitions import APP_ROUTE_BASENAME as SMILEIT_ROUTE_BASENAME
from apps.smileit.definitions import APP_ROUTE_PREFIX as SMILEIT_ROUTE_PREFIX
from apps.smileit.routers import SmileitJobViewSet
from apps.toxicity_properties.definitions import (
    APP_ROUTE_BASENAME as TOXICITY_PROPERTIES_ROUTE_BASENAME,
)
from apps.toxicity_properties.definitions import (
    APP_ROUTE_PREFIX as TOXICITY_PROPERTIES_ROUTE_PREFIX,
)
from apps.toxicity_properties.routers import ToxicityPropertiesJobViewSet
from apps.tunnel.definitions import APP_ROUTE_BASENAME as TUNNEL_ROUTE_BASENAME
from apps.tunnel.definitions import APP_ROUTE_PREFIX as TUNNEL_ROUTE_PREFIX
from apps.tunnel.routers import TunnelJobViewSet
from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularRedocView,
    SpectacularSwaggerView,
)
from rest_framework.routers import DefaultRouter

router = DefaultRouter()
router.trailing_slash = "/?"
router.register(CORE_JOBS_ROUTE_PREFIX, JobViewSet, basename=CORE_JOBS_ROUTE_BASENAME)
router.register(
    MOLAR_FRACTIONS_ROUTE_PREFIX,
    MolarFractionsJobViewSet,
    basename=MOLAR_FRACTIONS_ROUTE_BASENAME,
)
router.register(
    TUNNEL_ROUTE_PREFIX,
    TunnelJobViewSet,
    basename=TUNNEL_ROUTE_BASENAME,
)
router.register(
    EASY_RATE_ROUTE_PREFIX,
    EasyRateJobViewSet,
    basename=EASY_RATE_ROUTE_BASENAME,
)
router.register(
    MARCUS_ROUTE_PREFIX,
    MarcusJobViewSet,
    basename=MARCUS_ROUTE_BASENAME,
)
router.register(
    SMILEIT_ROUTE_PREFIX,
    SmileitJobViewSet,
    basename=SMILEIT_ROUTE_BASENAME,
)
router.register(
    SA_SCORE_ROUTE_PREFIX,
    SaScoreJobViewSet,
    basename=SA_SCORE_ROUTE_BASENAME,
)
router.register(
    TOXICITY_PROPERTIES_ROUTE_PREFIX,
    ToxicityPropertiesJobViewSet,
    basename=TOXICITY_PROPERTIES_ROUTE_BASENAME,
)

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path(
        "api/docs/",
        SpectacularSwaggerView.as_view(url_name="schema"),
        name="swagger-ui",
    ),
    path("api/redoc/", SpectacularRedocView.as_view(url_name="schema"), name="redoc"),
    path("api/auth/login/", DomainTokenObtainPairView.as_view(), name="auth-login"),
    path("api/auth/refresh/", DomainTokenRefreshView.as_view(), name="auth-refresh"),
    path("api/auth/me/", CurrentUserProfileView.as_view(), name="auth-me"),
    path("api/auth/apps/", CurrentUserAccessibleAppsView.as_view(), name="auth-apps"),
    path(
        "api/auth/app-configs/<str:app_name>/",
        CurrentUserAppConfigView.as_view(),
        name="auth-app-config",
    ),
    path("api/identity/users/", IdentityUsersView.as_view(), name="identity-users"),
    path(
        "api/identity/users/<int:user_id>/",
        IdentityUserDetailView.as_view(),
        name="identity-user-detail",
    ),
    path("api/identity/groups/", WorkGroupsView.as_view(), name="identity-groups"),
    path(
        "api/identity/groups/<int:group_id>/",
        WorkGroupDetailView.as_view(),
        name="identity-group-detail",
    ),
    path(
        "api/identity/groups/<int:group_id>/app-configs/<str:app_name>/",
        GroupAppConfigDetailView.as_view(),
        name="identity-group-app-config",
    ),
    path(
        "api/identity/scientific-apps/",
        ScientificAppCatalogView.as_view(),
        name="identity-scientific-apps",
    ),
    path(
        "api/identity/memberships/",
        GroupMembershipsView.as_view(),
        name="identity-memberships",
    ),
    path(
        "api/identity/memberships/<int:membership_id>/",
        GroupMembershipDetailView.as_view(),
        name="identity-membership-detail",
    ),
    path(
        "api/identity/app-permissions/",
        AppPermissionsView.as_view(),
        name="identity-app-permissions",
    ),
    path(
        "api/identity/app-permissions/<int:permission_id>/",
        AppPermissionDetailView.as_view(),
        name="identity-app-permission-detail",
    ),
    path("api/", include(router.urls)),
]
