// auth-api.service.ts: Wrapper estable para autenticación JWT y perfil actual.

import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { AuthService } from './generated';

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
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
}

interface LoginApiResponse {
  access: string;
  refresh: string;
}

interface RefreshApiResponse {
  access: string;
}

@Injectable({
  providedIn: 'root',
})
export class AuthApiService {
  private readonly authClient = inject(AuthService);

  login(username: string, password: string): Observable<SessionTokens> {
    return this.authClient
      .authLoginCreate({ username, password })
      .pipe(
        map((response: LoginApiResponse) => ({
          accessToken: response.access,
          refreshToken: response.refresh,
        })),
      );
  }

  refresh(refreshToken: string): Observable<string> {
    return this.authClient
      .authRefreshCreate({ refresh: refreshToken })
      .pipe(map((response: RefreshApiResponse) => response.access));
  }

  getCurrentUserProfile(): Observable<CurrentUserProfileView> {
    return this.authClient.authMeRetrieve() as Observable<CurrentUserProfileView>;
  }
}
