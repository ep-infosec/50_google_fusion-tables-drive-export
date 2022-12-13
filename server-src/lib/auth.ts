/*!
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {google} from 'googleapis';
import credentials from '../config/credentials.json';
import {OAuth2Client} from 'google-auth-library';
import {Request} from 'express';

const SCOPE = [
  'https://www.googleapis.com/auth/fusiontables.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.metadata.readonly'
];

/**
 * Create an OAuth client
 */
export function getOAuthClient(req: Request): OAuth2Client {
  const redirectUri =
    req.headers.host && req.headers.host === 'localhost:3000'
      ? 'http://localhost:3000/auth/callback'
      : `https://${req.headers.host}/auth/callback`;

  return new google.auth.OAuth2(
    credentials.web.client_id,
    credentials.web.client_secret,
    redirectUri
  );
}

/**
 * Get the URL for authentication
 */
export function getAuthUrl(req: Request): string {
  const oauth2Client = getOAuthClient(req);
  return oauth2Client.generateAuthUrl({scope: SCOPE});
}
