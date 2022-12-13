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

import {google, drive_v3, sheets_v4} from 'googleapis';
import {OAuth2Client} from 'google-auth-library';
import promiseRetry from 'promise-retry';
import findFile from './find-file';
import {
  DRIVE_ARCHIVE_INDEX_SHEET,
  MIME_TYPES,
  RETRY_OPTIONS
} from '../config/config';
import {ISheet} from '../interfaces/sheet';

const drive = google.drive('v3');
const sheets = google.sheets('v4');

const headerRowContent = [
  'Exported file name',
  'Source Fusiontable',
  'Exported Spreadsheet/CSV',
  'Type',
  'Visualization',
  'Exported at'
].join(',');

/**
 * Get the Archive Index Sheet
 */
export default async function(
  auth: OAuth2Client,
  archiveFolderId: string
): Promise<ISheet> {
  try {
    const spreadsheetId = await findFile(
      auth,
      DRIVE_ARCHIVE_INDEX_SHEET,
      archiveFolderId
    );

    if (!spreadsheetId) {
      return createSheet(auth, archiveFolderId);
    }

    const sheetId = await getFirstSheet(auth, spreadsheetId);

    return {
      spreadsheetId,
      sheetId
    };
  } catch (error) {
    throw error;
  }
}

/**
 * Wrapper around the actual function with exponential retries
 */
function getFirstSheet(
  auth: OAuth2Client,
  spreadsheetId: string
): Promise<number> {
  return promiseRetry(
    retry => getFirstSheetWorker(auth, spreadsheetId).catch(retry),
    RETRY_OPTIONS
  );
}

/**
 * Get the first sheet in a spreadsheet
 */
async function getFirstSheetWorker(
  auth: OAuth2Client,
  spreadsheetId: string
): Promise<number> {
  try {
    const response = await sheets.spreadsheets.get({
      auth,
      spreadsheetId,
      fields: 'sheets'
    });

    const firstSheet = (response.data.sheets as sheets_v4.Schema$Sheet[])[0];
    const sheetId = firstSheet.properties && firstSheet.properties.sheetId;

    if (!sheetId) {
      throw new Error(
        `Cannot find Sheet in Spreadsheet: ${response.statusText}`
      );
    }

    return sheetId;
  } catch (error) {
    if (error.response.data.error.code === 404) {
      throw new Error(
        `The file "${DRIVE_ARCHIVE_INDEX_SHEET}" was created by a deprecated ` +
        `version of the exporter. Please rename or remove it to allow the ` +
        `application to create a new one.`
      );
    }

    throw error;
  }
}

/**
 * Wrapper around the actual function with exponential retries
 */
function createSheet(
  auth: OAuth2Client,
  archiveFolderId: string
): Promise<ISheet> {
  return promiseRetry(
    retry => createSheetWorker(auth, archiveFolderId).catch(retry),
    RETRY_OPTIONS
  );
}

/**
 * Create the Archive Index Sheet with a title row
 */
async function createSheetWorker(
  auth: OAuth2Client,
  archiveFolderId: string
): Promise<ISheet> {
  try {
    const response = await drive.files.create({
      auth,
      resource: {
        name: DRIVE_ARCHIVE_INDEX_SHEET,
        parents: [archiveFolderId],
        mimeType: MIME_TYPES.spreadsheet
      },
      media: {
        mimeType: MIME_TYPES.csv,
        body: headerRowContent
      }
    } as drive_v3.Params$Resource$Files$Create);

    if (response.statusText !== 'OK') {
      throw new Error(`Cannot create new Sheet: ${response.statusText}`);
    }

    const spreadsheetId = response.data.id as string;
    const sheetId = await getFirstSheet(auth, spreadsheetId);

    await sheets.spreadsheets.batchUpdate({
      auth,
      spreadsheetId,
      requestBody: {
        requests: [
          {
            repeatCell: {
              range: {
                sheetId,
                startRowIndex: 0,
                endRowIndex: 1
              },
              cell: {
                userEnteredFormat: {
                  horizontalAlignment: 'CENTER',
                  textFormat: {
                    fontSize: 12,
                    bold: true
                  }
                }
              },
              fields: 'userEnteredFormat(textFormat,horizontalAlignment)'
            }
          },
          {
            updateDimensionProperties: {
              range: {
                sheetId,
                dimension: 'COLUMNS',
                startIndex: 0,
                endIndex: 6
              },
              properties: {
                pixelSize: 250
              },
              fields: 'pixelSize'
            }
          },
          {
            updateSheetProperties: {
              properties: {
                sheetId,
                gridProperties: {
                  frozenRowCount: 1
                }
              },
              fields: 'gridProperties.frozenRowCount'
            }
          }
        ]
      }
    } as sheets_v4.Params$Resource$Spreadsheets$Batchupdate);

    return {
      spreadsheetId,
      sheetId
    };
  } catch (error) {
    throw error;
  }
}
