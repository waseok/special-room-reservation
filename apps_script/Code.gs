/**
 * Google Apps Script Web App (서버 역할)
 *
 * 시트 탭:
 * - Rooms
 * - Reservations
 *
 * 필수 헤더(1행):
 * Rooms: id, name, createdAt, updatedAt(선택)
 * Reservations: id, roomId(roomID도 허용), date, period, name, class, purpose, createdAt(createAt도 허용), updatedAt
 *
 * 배포:
 * - Apps Script 편집기 → 배포 → 새 배포 → 유형: 웹 앱
 * - 실행 권한: 나(소유자)
 * - 액세스 권한: \"모든 사용자\" (로그인 없이 누구나)
 *
 * API:
 * - GET  ?action=export
 * - POST action=upsertAll payload={ rooms:[], reservations:[] }  (application/x-www-form-urlencoded)
 */

const SHEET_ROOMS = 'Rooms';
const SHEET_RES = 'Reservations';

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || '';
  if (action === 'export') {
    const meta = computeMeta_();
    return json_({
      ok: true,
      meta: meta,
      rooms: readObjects_(SHEET_ROOMS),
      reservations: readObjects_(SHEET_RES),
    });
  }
  return json_({ ok: false, error: 'unknown_action' });
}

function doPost(e) {
  const action = (e && e.parameter && e.parameter.action) || '';
  if (action === 'upsertAll') {
    const payloadStr = (e && e.parameter && e.parameter.payload) || '';
    if (!payloadStr) return json_({ ok: false, error: 'missing_payload' });

    let payload;
    try {
      payload = JSON.parse(payloadStr);
    } catch (err) {
      return json_({ ok: false, error: 'invalid_json' });
    }

    const rooms = Array.isArray(payload.rooms) ? payload.rooms : [];
    const reservations = Array.isArray(payload.reservations) ? payload.reservations : [];

    // upsert
    upsertById_(SHEET_ROOMS, rooms);
    upsertById_(SHEET_RES, reservations);

    return json_({ ok: true, meta: computeMeta_() });
  }

  if (action === 'upsertRoom') {
    const payloadStr = (e && e.parameter && e.parameter.payload) || '';
    if (!payloadStr) return json_({ ok: false, error: 'missing_payload' });
    let room;
    try {
      room = JSON.parse(payloadStr);
    } catch (err) {
      return json_({ ok: false, error: 'invalid_json' });
    }
    upsertById_(SHEET_ROOMS, [room]);
    return json_({ ok: true, meta: computeMeta_() });
  }

  if (action === 'upsertReservation') {
    const payloadStr = (e && e.parameter && e.parameter.payload) || '';
    if (!payloadStr) return json_({ ok: false, error: 'missing_payload' });
    let resv;
    try {
      resv = JSON.parse(payloadStr);
    } catch (err) {
      return json_({ ok: false, error: 'invalid_json' });
    }
    upsertById_(SHEET_RES, [resv]);
    return json_({ ok: true, meta: computeMeta_() });
  }

  if (action === 'deleteReservation') {
    const id = (e && e.parameter && e.parameter.id) || '';
    if (!id) return json_({ ok: false, error: 'missing_id' });
    deleteById_(SHEET_RES, id);
    return json_({ ok: true, meta: computeMeta_() });
  }

  if (action === 'deleteRoom') {
    const id = (e && e.parameter && e.parameter.id) || '';
    if (!id) return json_({ ok: false, error: 'missing_id' });
    // room 삭제
    deleteById_(SHEET_ROOMS, id);
    // 해당 roomId를 가진 예약도 함께 삭제
    deleteReservationsByRoomId_(id);
    return json_({ ok: true, meta: computeMeta_() });
  }

  return json_({ ok: false, error: 'unknown_action' });
}

/** ---------- Helpers ---------- */

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function sheet_(name) {
  const s = ss_().getSheetByName(name);
  if (!s) throw new Error('Missing sheet: ' + name);
  return s;
}

function normalizeKey_(k) {
  // roomID, roomId -> roomid
  // createAt, createdAt -> createdat
  return String(k || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

/**
 * 서버 변경 감지를 위한 메타 정보를 계산합니다.
 * - version: Rooms/Reservations의 updatedAt(없으면 createdAt) 최대값 ISO 문자열
 */
function computeMeta_() {
  const v1 = maxTimestamp_(SHEET_ROOMS);
  const v2 = maxTimestamp_(SHEET_RES);
  const version = [v1, v2].sort().pop() || new Date().toISOString();
  return { version: version, serverTime: new Date().toISOString() };
}

function maxTimestamp_(sheetName) {
  const sh = sheet_(sheetName);
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return '';

  const head = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || '').trim());
  const headNorm = head.map(normalizeKey_);

  const updatedCol = headNorm.indexOf('updatedat');
  const createdCol = headNorm.indexOf('createdat'); // createdAt/createAt
  const col = updatedCol !== -1 ? updatedCol : createdCol;
  if (col === -1) return '';

  const values = sh.getRange(2, 1 + col, lastRow - 1, 1).getValues().flat();
  let max = '';
  values.forEach(v => {
    const s = String(v || '').trim();
    if (s && s > max) max = s; // ISO 문자열 비교
  });
  return max;
}

function readObjects_(sheetName) {
  const sh = sheet_(sheetName);
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];

  const values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = values[0].map(h => String(h || '').trim());
  const headerMap = {};
  headers.forEach((h, idx) => {
    headerMap[normalizeKey_(h)] = idx;
  });
  const idIdx = typeof headerMap.id === 'number' ? headerMap.id : -1;

  const out = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    // 빈 줄 스킵
    if (row.every(v => v === '' || v === null)) continue;
    // id가 비어있는 행은 export에서 제외 (클라이언트 병합 시 \"삭제\"처럼 보이는 현상 방지)
    if (idIdx !== -1) {
      const idVal = String(row[idIdx] || '').trim();
      if (!idVal) continue;
    }

    const obj = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      if (!key) continue;
      obj[key] = row[c];
    }

    // 호환 처리: roomID -> roomId, createAt -> createdAt
    if (obj.roomID && !obj.roomId) obj.roomId = obj.roomID;
    if (obj.createAt && !obj.createdAt) obj.createdAt = obj.createAt;

    out.push(obj);
  }
  return out;
}

function deleteById_(sheetName, id) {
  const sh = sheet_(sheetName);
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return;

  const head = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || '').trim());
  const headNorm = head.map(normalizeKey_);
  const idCol = headNorm.indexOf('id');
  if (idCol === -1) throw new Error('Missing id column in ' + sheetName);

  const ids = sh.getRange(2, 1 + idCol, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    const cur = String(ids[i][0] || '').trim();
    if (cur === id) {
      sh.deleteRow(i + 2);
      return;
    }
  }
}

function deleteReservationsByRoomId_(roomId) {
  const sh = sheet_(SHEET_RES);
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return;

  const head = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || '').trim());
  const headNorm = head.map(normalizeKey_);
  // roomId 또는 roomID
  let col = headNorm.indexOf('roomid');
  if (col === -1) return;

  const vals = sh.getRange(2, 1 + col, lastRow - 1, 1).getValues();
  // 아래에서 위로 삭제 (인덱스 깨짐 방지)
  for (let i = vals.length - 1; i >= 0; i--) {
    const cur = String(vals[i][0] || '').trim();
    if (cur === roomId) {
      sh.deleteRow(i + 2);
    }
  }
}

function upsertById_(sheetName, items) {
  const sh = sheet_(sheetName);
  const lastCol = Math.max(1, sh.getLastColumn());
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || '').trim());

  // 헤더가 비어있으면 최소 헤더 작성(사용자가 이미 만들었으면 그대로 사용)
  if (!headers[0]) {
    if (sheetName === SHEET_ROOMS) {
      sh.getRange(1, 1, 1, 4).setValues([['id', 'name', 'createdAt', 'updatedAt']]);
    } else {
      sh
        .getRange(1, 1, 1, 9)
        .setValues([['id', 'roomId', 'date', 'period', 'name', 'class', 'purpose', 'createdAt', 'updatedAt']]);
    }
  }

  const lastRow = sh.getLastRow();
  const finalCol = sh.getLastColumn();
  const head = sh.getRange(1, 1, 1, finalCol).getValues()[0].map(h => String(h || '').trim());
  const headNorm = head.map(normalizeKey_);

  const idCol = headNorm.indexOf('id');
  if (idCol === -1) throw new Error('Missing id column in ' + sheetName);

  // 기존 id -> row index(1-based)
  const idToRow = {};
  if (lastRow >= 2) {
    const ids = sh.getRange(2, 1 + idCol, lastRow - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      const id = String(ids[i][0] || '').trim();
      if (id) idToRow[id] = i + 2;
    }
  }

  const now = new Date().toISOString();
  const createdAtCol = headNorm.indexOf('createdat'); // createdAt / createAt 모두 허용
  const updatedAtCol = headNorm.indexOf('updatedat');

  items.forEach(item => {
    const id = String(item.id || '').trim();
    if (!id) return;

    const targetRow = idToRow[id] || sh.getLastRow() + 1;

    const rowArr = new Array(head.length).fill('');
    // 기존 row가 있으면 기존값을 기반으로 업데이트 (createdAt 유지 목적)
    if (idToRow[id]) {
      const existing = sh.getRange(targetRow, 1, 1, head.length).getValues()[0];
      for (let i = 0; i < existing.length; i++) rowArr[i] = existing[i];
    }

    // item의 key를 헤더 기준으로 채움(헤더명 기반)
    for (const key in item) {
      const n = normalizeKey_(key);
      const col = headNorm.indexOf(n);
      if (col !== -1) rowArr[col] = item[key];
      // 호환: roomID -> roomId
      if (n === 'roomid') {
        const col2 = headNorm.indexOf('roomid');
        if (col2 !== -1) rowArr[col2] = item[key];
      }
      if (n === 'createat' && createdAtCol !== -1) rowArr[createdAtCol] = item[key];
    }

    if (createdAtCol !== -1 && !rowArr[createdAtCol]) rowArr[createdAtCol] = now;
    if (updatedAtCol !== -1) rowArr[updatedAtCol] = now;

    sh.getRange(targetRow, 1, 1, head.length).setValues([rowArr]);
  });
}

