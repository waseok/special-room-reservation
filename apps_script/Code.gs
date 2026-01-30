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
const SHEET_HINTS = 'Hints';

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || '';
  if (action === 'export') {
    const meta = computeMeta_();
    return json_({
      ok: true,
      meta: meta,
      rooms: readObjects_(SHEET_ROOMS),
      reservations: readObjects_(SHEET_RES),
      hints: readObjects_(SHEET_HINTS),
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
    const hints = Array.isArray(payload.hints) ? payload.hints : [];

    // upsert
    upsertById_(SHEET_ROOMS, rooms);
    upsertById_(SHEET_RES, reservations);
    upsertById_(SHEET_HINTS, hints);

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

  // ---- Hints (기본 배정/워터마크) ----
  if (action === 'upsertHint') {
    const payloadStr = (e && e.parameter && e.parameter.payload) || '';
    if (!payloadStr) return json_({ ok: false, error: 'missing_payload' });
    let hint;
    try {
      hint = JSON.parse(payloadStr);
    } catch (err) {
      return json_({ ok: false, error: 'invalid_json' });
    }
    upsertById_(SHEET_HINTS, [hint]);
    return json_({ ok: true, meta: computeMeta_() });
  }

  if (action === 'deleteHint') {
    const id = (e && e.parameter && e.parameter.id) || '';
    if (!id) return json_({ ok: false, error: 'missing_id' });
    deleteById_(SHEET_HINTS, id);
    return json_({ ok: true, meta: computeMeta_() });
  }

  // ---- Admin/Repair ----
  // 시트가 수동 편집 등으로 지저분해졌을 때(중복 id, 같은 이름의 방이 여러 개 등)
  // "서버(시트) 자체"를 한 번에 정리하는 관리자용 엔드포인트입니다.
  //
  // 호출:
  //   POST action=repair password=8714
  // 응답:
  //   { ok:true, meta:{...}, summary:{...} }
  //
  // 주의:
  // - 이 서버는 로그인 없이 접근 가능한 구조라, 강한 보안이 아닙니다.
  // - 최소 방어로 공통 비밀번호(8714)를 요구합니다.
  if (action === 'repair') {
    const password = (e && e.parameter && e.parameter.password) || '';
    if (String(password) !== '8714') return json_({ ok: false, error: 'forbidden' });

    const summary = repairAll_();
    return json_({ ok: true, meta: computeMeta_(), summary: summary });
  }

  return json_({ ok: false, error: 'unknown_action' });
}

/** ---------- Helpers ---------- */

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function sheet_(name) {
  const ss = ss_();
  let s = ss.getSheetByName(name);
  if (!s) {
    // 새 기능(Hints 등) 추가 시, 기존 시트에 탭이 없으면 자동 생성해 운영 부담을 줄입니다.
    s = ss.insertSheet(name);
  }
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
  const v3 = maxTimestamp_(SHEET_HINTS);
  const version = [v1, v2, v3].sort().pop() || new Date().toISOString();
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
  const createdCol = headNorm.indexOf('createdat') !== -1 ? headNorm.indexOf('createdat') : headNorm.indexOf('createat'); // createdAt/createAt
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
  // 탭이 없으면 빈 배열(기능 비활성/미생성 상태에서도 export가 깨지지 않게)
  try {
    sheet_(sheetName);
  } catch (e) {
    return [];
  }
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

  // id 중복이 있으면(과거 데이터/수동 편집 등) 클라이언트에서 \"삭제\"처럼 보일 수 있어
  // export 단계에서 id 기준으로 하나만 남기고(updatedAt 최신 우선) 정리합니다.
  const byId = {};
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

    // id 추출
    const idVal = idIdx !== -1 ? String(row[idIdx] || '').trim() : '';
    if (!idVal) continue;

    // updatedAt/createdAt(또는 createAt) 기준으로 최신을 남김
    const ts = String(getFieldByNorm_(obj, 'updatedat') || getFieldByNorm_(obj, 'createdat') || getFieldByNorm_(obj, 'createat') || '').trim();
    const prev = byId[idVal];
    if (!prev) {
      byId[idVal] = { obj: obj, ts: ts };
    } else {
      // ISO 문자열 비교 (비어있으면 기존 유지)
      if (ts && (!prev.ts || ts >= prev.ts)) {
        byId[idVal] = { obj: obj, ts: ts };
      }
    }
  }
  return Object.keys(byId).map(k => byId[k].obj);
}

function getFieldByNorm_(obj, normKey) {
  for (var k in obj) {
    if (normalizeKey_(k) === normKey) return obj[k];
  }
  return '';
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
      if (sheetName === SHEET_RES) {
        sh
          .getRange(1, 1, 1, 9)
          .setValues([['id', 'roomId', 'date', 'period', 'name', 'class', 'purpose', 'createdAt', 'updatedAt']]);
      } else if (sheetName === SHEET_HINTS) {
        sh
          .getRange(1, 1, 1, 8)
          .setValues([['id', 'kind', 'roomId', 'dayIndex', 'slotId', 'text', 'createdAt', 'updatedAt']]);
      }
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
  const createdAtCol = headNorm.indexOf('createdat') !== -1 ? headNorm.indexOf('createdat') : headNorm.indexOf('createat'); // createdAt / createAt 모두 허용
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

/** ---------- Repair ---------- */

function fixedRooms_() {
  return [
    { id: 'room-fixed-music', name: '음악실' },
    { id: 'room-fixed-library', name: '도서실' },
    { id: 'room-fixed-4f-meeting', name: '4층 회의실' },
    { id: 'room-fixed-1f-av', name: '1층 시청각실' },
  ];
}

function normName_(name) {
  return String(name || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function repairAll_() {
  // 1) Rooms 정리: 고정방 canonicalize + 빈 id 제거 + 중복 id/중복 이름 정리
  const roomsResult = repairRooms_();
  // 2) Reservations 정리: roomId 매핑 + 빈 id 제거 + 중복 id 정리
  const resResult = repairReservations_(roomsResult.idMap);
  return {
    rooms: roomsResult.summary,
    reservations: resResult.summary,
  };
}

function repairRooms_() {
  const sh = sheet_(SHEET_ROOMS);
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2) {
    // 시트가 비어있으면 고정방만 생성
    upsertById_(SHEET_ROOMS, fixedRooms_());
    return { idMap: {}, summary: { createdFixed: fixedRooms_().length, removedRows: 0, mergedByName: 0, dedupedById: 0 } };
  }

  const values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = values[0].map(h => String(h || '').trim());
  const headerMap = {};
  headers.forEach((h, idx) => (headerMap[normalizeKey_(h)] = idx));
  const idIdx = typeof headerMap.id === 'number' ? headerMap.id : -1;
  const nameIdx = typeof headerMap.name === 'number' ? headerMap.name : -1;
  if (idIdx === -1) throw new Error('Missing id column in Rooms');

  // 현재 rows 수집
  const rows = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    if (row.every(v => v === '' || v === null)) continue;
    const id = String(row[idIdx] || '').trim();
    const name = nameIdx !== -1 ? String(row[nameIdx] || '').trim() : '';
    rows.push({ r: r + 1, id: id, name: name, row: row });
  }

  const idMap = {}; // oldId -> canonicalId
  let mergedByName = 0;

  // 고정방을 canonicalize하기 위한 name->fixed
  const fixed = fixedRooms_();
  const fixedByNorm = {};
  fixed.forEach(f => (fixedByNorm[normName_(f.name)] = f));

  // 1) name 기반으로 고정방 후보를 찾아 canonical id로 매핑
  rows.forEach(it => {
    const fn = fixedByNorm[normName_(it.name)];
    if (!fn) return;
    if (it.id && it.id !== fn.id) {
      idMap[it.id] = fn.id;
      mergedByName++;
    }
  });

  // 2) fixedRooms upsert(항상 존재/이름 고정)
  upsertById_(SHEET_ROOMS, fixed);

  // 3) Rooms 시트 자체를 "id 기준"으로 정리(빈 id 제거 + 중복 id 제거)
  // - 중복 id는 아래에서 위로 삭제
  const existing = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  const head = existing[0].map(h => String(h || '').trim());
  const headNorm = head.map(normalizeKey_);
  const idCol = headNorm.indexOf('id');
  const nameCol = headNorm.indexOf('name');

  const byId = {};
  const toDelete = [];
  for (let i = 1; i < existing.length; i++) {
    const row = existing[i];
    if (row.every(v => v === '' || v === null)) continue;
    const id = String(row[idCol] || '').trim();
    if (!id) {
      toDelete.push(i + 1);
      continue;
    }
    const nm = nameCol !== -1 ? String(row[nameCol] || '').trim() : '';
    const key = id;
    if (byId[key]) {
      // 단순 중복은 뒤쪽 행 삭제(최근이 앞/뒤인지 알 수 없어서, 안전하게 "뒤쪽"만 삭제)
      toDelete.push(i + 1);
    } else {
      byId[key] = { row: i + 1, name: nm };
    }
  }

  // name이 고정방과 동일하지만 id가 고정 id가 아닌 경우도 삭제 대상(고정방이 우선)
  if (nameCol !== -1) {
    const fixedNames = {};
    fixed.forEach(f => (fixedNames[normName_(f.name)] = f.id));
    for (let i = 1; i < existing.length; i++) {
      const row = existing[i];
      if (row.every(v => v === '' || v === null)) continue;
      const id = String(row[idCol] || '').trim();
      const nm = String(row[nameCol] || '').trim();
      const fixedId = fixedNames[normName_(nm)];
      if (fixedId && id && id !== fixedId) {
        idMap[id] = fixedId;
        toDelete.push(i + 1);
      }
    }
  }

  // 중복 삭제(내림차순)
  const uniq = {};
  toDelete.forEach(rn => (uniq[rn] = true));
  const delRows = Object.keys(uniq)
    .map(x => Number(x))
    .sort((a, b) => b - a);
  delRows.forEach(rn => sh.deleteRow(rn));

  return {
    idMap: idMap,
    summary: {
      createdFixed: fixed.length,
      removedRows: delRows.length,
      mergedByName: mergedByName,
      dedupedById: delRows.length,
    },
  };
}

function repairReservations_(idMap) {
  const sh = sheet_(SHEET_RES);
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) {
    return { summary: { removedRows: 0, remappedRoomId: 0, dedupedById: 0 } };
  }

  const values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = values[0].map(h => String(h || '').trim());
  const headerMap = {};
  headers.forEach((h, idx) => (headerMap[normalizeKey_(h)] = idx));
  const idIdx = typeof headerMap.id === 'number' ? headerMap.id : -1;
  let roomIdx = headerMap.roomid;
  if (typeof roomIdx !== 'number') roomIdx = -1;
  if (idIdx === -1) throw new Error('Missing id column in Reservations');

  // 삭제/수정 대상 수집
  const toDelete = [];
  let remapped = 0;

  // 중복 id는 "updatedAt/createdAt" 최신 1개만 남기고 삭제
  const updatedIdx = typeof headerMap.updatedat === 'number' ? headerMap.updatedat : -1;
  const createdIdx =
    typeof headerMap.createdat === 'number'
      ? headerMap.createdat
      : typeof headerMap.createat === 'number'
      ? headerMap.createat
      : -1;

  const bestById = {}; // id -> { rowNumber, ts }
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    if (row.every(v => v === '' || v === null)) continue;
    const id = String(row[idIdx] || '').trim();
    if (!id) {
      toDelete.push(r + 1);
      continue;
    }
    const ts = String((updatedIdx !== -1 ? row[updatedIdx] : '') || (createdIdx !== -1 ? row[createdIdx] : '') || '').trim();
    const prev = bestById[id];
    if (!prev) {
      bestById[id] = { rowNumber: r + 1, ts: ts };
    } else {
      // 최신 유지(타임스탬프가 없으면 기존 유지)
      if (ts && (!prev.ts || ts >= prev.ts)) {
        toDelete.push(prev.rowNumber);
        bestById[id] = { rowNumber: r + 1, ts: ts };
      } else {
        toDelete.push(r + 1);
      }
    }
  }

  // roomId 매핑(행 직접 수정)
  if (roomIdx !== -1) {
    for (let r = 1; r < values.length; r++) {
      const row = values[r];
      if (row.every(v => v === '' || v === null)) continue;
      const id = String(row[idIdx] || '').trim();
      if (!id) continue;
      const curRoomId = String(row[roomIdx] || '').trim();
      const mapped = idMap && idMap[curRoomId];
      if (mapped && mapped !== curRoomId) {
        sh.getRange(r + 1, roomIdx + 1, 1, 1).setValues([[mapped]]);
        remapped++;
      }
    }
  }

  // 삭제 실행(내림차순)
  const uniq = {};
  toDelete.forEach(rn => (uniq[rn] = true));
  const delRows = Object.keys(uniq)
    .map(x => Number(x))
    .sort((a, b) => b - a);
  delRows.forEach(rn => sh.deleteRow(rn));

  return {
    summary: {
      removedRows: delRows.length,
      remappedRoomId: remapped,
      dedupedById: delRows.length,
    },
  };
}

