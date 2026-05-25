// auth-api.service.ts: Wrapper estable para autenticación JWT y perfil actual.

import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { API_BASE_URL } from '../shared/constants';
import { AuthService } from './generated';

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

export interface RegisterPayload {
  username: string;
  email: string;
  password: string;
  first_name?: string;
  last_name?: string;
  registration_token?: string;
}

export interface RegisterResponse {
  user: CurrentUserProfileView;
  access?: string;
  refresh?: string;
}

export interface CurrentUserProfileView {
  id: number;
  username: string;
  email: string;
  role: 'root' | 'admin' | 'user';
  account_status: 'active' | 'inactive';
  first_name: string;
  last_name: string;
  avatar: string;
  email_verified: boolean;
  primary_group_id: number | null;
  created_at: string | null;
  updated_at: string | null;
  /** Membresías del usuario con su rol en cada grupo. */
  memberships: UserMembershipSummary[];
}

/** Resumen de membresía devuelto por /auth/me/ para construir el selector de grupo activo. */
export interface UserMembershipSummary {
  group_id: number;
  group_name: string;
  group_slug: string;
  role_in_group: 'admin' | 'member';
}

interface LoginApiResponse {
  access: string;
  refresh: string;
}

interface RefreshApiResponse {
  access: string;
  refresh?: string;
}

@Injectable({
  providedIn: 'root',
})
export class AuthApiService {
  private readonly httpClient = inject(HttpClient);
  private readonly authBaseUrl = `${API_BASE_URL}/api/auth`;
  private readonly authClient = inject(AuthService);

  register(payload: RegisterPayload): Observable<RegisterResponse> {
    return this.httpClient.post<RegisterResponse>(
      `${this.authBaseUrl}/register/`,
      payload,
    );
  }

  login(username: string, password: string): Observable<SessionTokens> {
    return this.authClient.authLoginCreate({ username, password }).pipe(
      map((response: LoginApiResponse) => ({
        accessToken: response.access,
        refreshToken: response.refresh,
      })),
    );
  }

  refresh(refreshToken: string): Observable<SessionTokens> {
    return this.authClient.authRefreshCreate({ refresh: refreshToken }).pipe(
      map((response: RefreshApiResponse) => ({
        accessToken: response.access,
        // Mantiene el refresh previo cuando el backend no devuelve rotación explícita.
        refreshToken: response.refresh ?? refreshToken,
      })),
    );
  }

  getCurrentUserProfile(): Observable<CurrentUserProfileView> {
    return this.authClient.authMeRetrieve() as Observable<CurrentUserProfileView>;
  }
}
