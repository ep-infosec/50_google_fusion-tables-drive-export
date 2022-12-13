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

import {google, sheets_v4} from 'googleapis';
import {OAuth2Client} from 'google-auth-library';
import promiseRetry from 'promise-retry';
import {ISheet} from '../interfaces/sheet';
import {ITable} from '../interfaces/table';
import {IStyle} from '../interfaces/style';
import {IFile} from '../interfaces/file';
import {MIME_TYPES, VISUALIZER_BASE_URI, RETRY_OPTIONS} from '../config/config';
import getStyleHash from '../lib/get-style-hash';

const sheets = google.sheets('v4');

interface ILogFileOptions {
  auth: OAuth2Client;
  sheet: ISheet;
  table: ITable;
  driveFile: IFile;
  styles: IStyle[];
  hasGeometryData: boolean;
  isLarge: boolean;
}

/**
 * Wrapper around the actual function with exponential retries
 */
export default function logFileExportInIndexSheet(
  options: ILogFileOptions
): Promise<void> {
  return promiseRetry(
    retry => logFileExportInIndexSheetWorker(options).catch(retry),
    RETRY_OPTIONS
  );
}

/**
 * Log an exported file in the index sheet
 */
async function logFileExportInIndexSheetWorker(
  options: ILogFileOptions
): Promise<void> {
  const {
    auth,
    sheet,
    table,
    driveFile,
    styles,
    hasGeometryData,
    isLarge
  } = options;
  const {spreadsheetId, sheetId} = sheet;
  const tableLink = `https://fusiontables.google.com/DataSource?docid=${table.id}`;
  const fileLink = `https://drive.google.com/open?id=${driveFile.id}`;
  const fileType =
    driveFile.mimeType === MIME_TYPES.csv ? 'CSV' : 'Spreadsheet';
  const visualizerBaseLink = `${VISUALIZER_BASE_URI}#file=${driveFile.id}`;
  const exportDate = new Date().toISOString();
  let rows = [];

  const createRow = (visualizerLink?: string, index?: number) => {
    const isFirstRow = index === 0 || index === undefined;
    const visualizationId = index !== undefined ? index + 1 : '';
    const visualizationValue = visualizerLink
      ? {
          formulaValue:
            `=HYPERLINK("${visualizerLink}",` +
            ` "Visualization ${visualizationId}")`
        }
      : {
          stringValue: 'Cannot visualize — no geometry found.'
        };

    return {
      values: [
        {userEnteredValue: {stringValue: driveFile.name}},
        {userEnteredValue: {stringValue: isFirstRow ? tableLink : ''}},
        {userEnteredValue: {stringValue: isFirstRow ? fileLink : ''}},
        {userEnteredValue: {stringValue: isFirstRow ? fileType : ''}},
        {userEnteredValue: visualizationValue},
        {userEnteredValue: {stringValue: exportDate}}
      ]
    };
  };

  if (!hasGeometryData) {
    rows = [createRow()];
  } else if (styles && styles.length > 0) {
    rows = styles.map((style, index) => {
      const visualizerLink =
        visualizerBaseLink +
        `&style=${getStyleHash(style)}` +
        (isLarge ? '&large=true' : '');

      return createRow(visualizerLink, styles.length > 1 ? index : undefined);
    });
  } else {
    const visualizerLink = visualizerBaseLink + (isLarge ? '&large=true' : '');
    rows = [createRow(visualizerLink)];
  }

  try {
    const response = await sheets.spreadsheets.batchUpdate({
      auth,
      spreadsheetId,
      requestBody: {
        requests: [
          {
            appendCells: {
              sheetId,
              rows,
              fields: 'userEnteredValue'
            }
          }
        ]
      }
    } as sheets_v4.Params$Resource$Spreadsheets$Batchupdate);

    if (response.statusText !== 'OK') {
      throw new Error(`Cannot log file export: ${response.statusText}`);
    }
  } catch (error) {
    throw error;
  }

  return;
}
