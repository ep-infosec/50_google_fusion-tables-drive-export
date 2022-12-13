/// <reference path="../interfaces/togeojson.d.ts" />
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

import pLimit from 'p-limit';
import {OAuth2Client} from 'google-auth-library';
import {ErrorReporting} from '@google-cloud/error-reporting';
import {ITable} from '../interfaces/table';
import {ISheet} from '../interfaces/sheet';
import getCsv from './get-csv';
import updateTableExportProgress from '../export-progress/update-table';
import getArchiveFolder from '../drive/get-archive-folder';
import getFusiontableStyles from '../fusiontables/get-styles';
import getDriveUploadFolder from '../drive/get-upload-folder';
import uploadToDrive from '../drive/upload';
import getArchiveIndexSheet from '../drive/get-archive-index-sheet';
import insertExportRowInIndexSheet from '../drive/insert-export-row-in-index-sheet';
import logFileExportInIndexSheet from '../drive/log-file-export-in-index-sheet';
import addFilePermissions from '../drive/add-file-permissions';
import logExportStart from '../export-log/log-export-start';
import logTableStart from '../export-log/log-table-start';
import logTableFinish from '../export-log/log-table-finish';
import logExportFinish from '../export-log/log-export-finish';
import {web as serverCredentials} from '../config/credentials.json';
import {IStyle} from '../interfaces/style';
import {IFile} from '../interfaces/file';

const errors = new ErrorReporting({
  reportUnhandledRejections: true,
  projectId: serverCredentials.project_id
});

/**
 * Export a table from FusionTables and save it to Drive
 */
interface IDoExportOptions {
  ipHash: string;
  auth: OAuth2Client;
  exportId: string;
  tables: ITable[];
}
export default async function(options: IDoExportOptions): Promise<string> {
  const {ipHash, auth, exportId, tables} = options;
  const limit = pLimit(1);
  let folderId: string;
  let archiveSheet: ISheet;

  logExportStart(exportId, tables.length);

  try {
    const archiveFolderId = await getArchiveFolder(auth);
    [folderId, archiveSheet] = await Promise.all([
      getDriveUploadFolder(auth, archiveFolderId),
      getArchiveIndexSheet(auth, archiveFolderId)
    ]);
    await insertExportRowInIndexSheet(auth, archiveSheet, folderId);
  } catch (error) {
    throw error;
  }

  tables.map((table, index) =>
    limit(() =>
      saveTable({
        tableId: index + 1,
        table,
        ipHash,
        auth,
        folderId,
        archiveSheet,
        exportId,
        isLast: index === tables.length - 1
      })
    )
  );

  return folderId;
}

/**
 * Save a table from FusionTables to Drive
 */
interface ISaveTableOptions {
  tableId: number;
  table: ITable;
  ipHash: string;
  auth: OAuth2Client;
  folderId: string;
  archiveSheet: ISheet;
  exportId: string;
  isLast: boolean;
}
async function saveTable(options: ISaveTableOptions): Promise<void> {
  const {tableId, table, auth, exportId, isLast} = options;
  const saveStart = Date.now();
  let fileSize: number = 0;
  let roundedFileSize: number = 0;
  let isLarge: boolean = false;
  let hasGeometryData: boolean = false;
  let driveFile: IFile | undefined;
  let styles: IStyle[] = [];

  logTableStart(exportId, tableId);

  try {
    const csv = await getCsv(auth, table);
    fileSize = Buffer.byteLength(csv.data, 'utf8') / 1024 / 1024;
    roundedFileSize = Math.pow(2, Math.floor(Math.log(fileSize) / Math.log(2)));
    isLarge = fileSize > 20;
    hasGeometryData = csv.hasGeometryData || false;
    [driveFile, styles] = await Promise.all([
      uploadToDrive(auth, options.folderId, csv),
      getFusiontableStyles(auth, table.id)
    ]);

    await Promise.all([
      logFileExportInIndexSheet({
        auth,
        sheet: options.archiveSheet,
        table,
        driveFile,
        styles,
        hasGeometryData,
        isLarge
      }),
      addFilePermissions(auth, driveFile.id, table.permissions),
      updateTableExportProgress({
        exportId,
        tableId: table.id,
        status: 'success',
        driveFile,
        styles,
        isLarge,
        fileSize: roundedFileSize,
        latency: Date.now() - saveStart,
        hasGeometryData
      })
    ]);

    logTableFinish(exportId, tableId, 'success', roundedFileSize);

    if (isLast) {
      logExportFinish(exportId);
    }
  } catch (error) {
    errors.report(error);
    await updateTableExportProgress({
      exportId,
      tableId: table.id,
      status: 'error',
      error: error.message,
      driveFile,
      styles,
      isLarge,
      fileSize: roundedFileSize,
      latency: Date.now() - saveStart,
      hasGeometryData
    });

    logTableFinish(exportId, tableId, 'error', roundedFileSize);

    if (isLast) {
      logExportFinish(exportId);
    }
  }
}
