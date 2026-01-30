/**
 * 로컬 스토리지 관리 모듈
 */

/**
 * 삭제/이름변경 불가한 "고정 특별실" 목록
 * - name은 UI에 표시되는 고정명
 * - id는 항상 동일한 canonical id (중복/병합의 기준)
 *
 * IMPORTANT:
 * - 서버(시트)에 과거에 같은 이름이 다른 id로 저장돼 있어도
 *   프론트에서 이 canonical id로 통합하여 "특별실이 막 늘어나는" 문제를 막습니다.
 */
const FIXED_ROOMS = [
    { id: 'room-fixed-music', name: '음악실' },
    { id: 'room-fixed-library', name: '도서실' },
    { id: 'room-fixed-4f-meeting', name: '4층 회의실' },
    { id: 'room-fixed-1f-av', name: '1층 시청각실' }
];

function normalizeRoomName_(name) {
    return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * 충돌 가능성이 낮은 ID를 생성합니다.
 * - 가능하면 `crypto.randomUUID()` 사용
 * - 지원하지 않으면 시간 + 난수 조합
 * @param {string} prefix
 * @returns {string}
 */
function generateId(prefix) {
    // 브라우저 환경에서 randomUUID 지원 시 사용
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `${prefix}-${crypto.randomUUID()}`;
    }
    // fallback (충분히 낮은 충돌 확률)
    const rand = Math.random().toString(16).slice(2);
    return `${prefix}-${Date.now()}-${rand}`;
}

const Storage = {
    // 스토리지 키
    KEYS: {
        ROOMS: 'specialRooms',
        RESERVATIONS: 'specialReservations'
    },

    FIXED_ROOMS,

    isFixedRoomId(roomId) {
        const id = String(roomId || '').trim();
        return this.FIXED_ROOMS.some(r => r.id === id);
    },

    isFixedRoomName(name) {
        const nn = normalizeRoomName_(name);
        return this.FIXED_ROOMS.some(r => normalizeRoomName_(r.name) === nn);
    },

    /**
     * 고정 특별실을 강제로 1개씩만 유지하고, 기존 예약(roomId)도 canonical id로 마이그레이션합니다.
     * - 같은 이름의 방이 여러 개 있거나(서버 불러오기 시) id가 달라도 -> 하나로 합칩니다.
     * - 합쳐지는 방의 id는 reservation.roomId에서 canonical id로 바뀝니다.
     *
     * @returns {{changed:boolean, idMap:Object<string,string>}}
     */
    ensureFixedRooms() {
        const rooms = this.getRooms();
        const reservations = this.getReservations();

        const idMap = {}; // oldId -> canonicalId
        let changed = false;

        // room 정리(고정방 우선)
        const kept = [];
        const removedIds = new Set();

        for (const fixed of this.FIXED_ROOMS) {
            const fixedNameNorm = normalizeRoomName_(fixed.name);
            const candidates = rooms.filter(r => r && (String(r.id || '').trim() === fixed.id || normalizeRoomName_(r.name) === fixedNameNorm));

            if (candidates.length === 0) {
                kept.push({ id: fixed.id, name: fixed.name });
                changed = true;
                continue;
            }

            // canonical로 남길 room 선택: id가 canonical인 것을 최우선, 아니면 첫 번째
            const canonical = candidates.find(r => String(r.id || '').trim() === fixed.id) || candidates[0];
            const canonicalOldId = String(canonical.id || '').trim();

            // canonical의 id/name을 고정값으로 강제
            if (canonicalOldId !== fixed.id) {
                idMap[canonicalOldId] = fixed.id;
                canonical.id = fixed.id;
                changed = true;
            }
            if (String(canonical.name || '').trim() !== fixed.name) {
                canonical.name = fixed.name;
                changed = true;
            }

            kept.push(canonical);

            // 나머지 후보는 제거 + id 매핑
            for (const c of candidates) {
                const cid = String(c?.id || '').trim();
                if (!cid) continue;
                if (cid === fixed.id) continue;
                idMap[cid] = fixed.id;
                removedIds.add(cid);
            }
        }

        // 고정방이 아닌 나머지 방들은 그대로 유지하되, 고정방 이름과 충돌하면 제거(고정방이 우선)
        for (const r of rooms) {
            if (!r) continue;
            const rid = String(r.id || '').trim();
            const rnameNorm = normalizeRoomName_(r.name);
            if (!rid) continue;
            if (removedIds.has(rid)) {
                changed = true;
                continue;
            }
            if (this.isFixedRoomId(rid)) {
                // 이미 kept에 들어있음(중복 방지)
                continue;
            }
            if (this.isFixedRoomName(r.name)) {
                // 같은 이름인데 고정 id가 아닌 방 -> 제거 + 매핑(예약도 이동)
                const canonical = this.FIXED_ROOMS.find(f => normalizeRoomName_(f.name) === rnameNorm);
                if (canonical) {
                    idMap[rid] = canonical.id;
                    changed = true;
                    continue;
                }
            }
            kept.push(r);
        }

        // 예약 roomId 마이그레이션
        let resChanged = false;
        for (const res of reservations) {
            if (!res) continue;
            const cur = String(res.roomId || '').trim();
            const mapped = idMap[cur];
            if (mapped && mapped !== cur) {
                res.roomId = mapped;
                resChanged = true;
            }
        }

        if (changed) this.saveRooms(kept);
        if (resChanged) this.saveReservations(reservations);

        return { changed: changed || resChanged, idMap };
    },

    /**
     * 특별실 목록을 가져옵니다.
     * @returns {Array} 특별실 배열
     */
    getRooms() {
        const data = localStorage.getItem(this.KEYS.ROOMS);
        return data ? JSON.parse(data) : [];
    },

    /**
     * 특별실 목록을 저장합니다.
     * @param {Array} rooms - 특별실 배열
     */
    saveRooms(rooms) {
        const normalized = Array.isArray(rooms) ? rooms.map(r => this._normalizeRoom(r)).filter(Boolean) : [];
        localStorage.setItem(this.KEYS.ROOMS, JSON.stringify(normalized));
    },

    /**
     * 새 특별실을 추가합니다.
     * @param {string} name - 특별실 이름
     * @returns {Object} 생성된 특별실 객체
     */
    addRoom(name) {
        const rooms = this.getRooms();
        // 고정 특별실 이름은 새로 추가하지 않고, 고정방을 보장하는 흐름으로 유도
        if (this.isFixedRoomName(name)) {
            this.ensureFixedRooms();
            // 고정방 반환
            const fixed = this.getRooms().find(r => normalizeRoomName_(r.name) === normalizeRoomName_(name));
            return fixed || null;
        }
        const newRoom = {
            id: generateId('room'),
            name: name
        };
        rooms.push(newRoom);
        this.saveRooms(rooms);
        return newRoom;
    },

    /**
     * 특별실 이름을 수정합니다.
     * @param {string} roomId - 특별실 ID
     * @param {string} newName - 새로운 이름
     */
    updateRoom(roomId, newName) {
        // 고정방은 이름 변경 금지
        if (this.isFixedRoomId(roomId)) return null;
        const rooms = this.getRooms();
        const index = rooms.findIndex(room => room.id === roomId);
        if (index !== -1) {
            rooms[index].name = newName;
            this.saveRooms(rooms);
            return rooms[index];
        }
        return null;
    },

    /**
     * 특별실을 삭제합니다.
     * @param {string} roomId - 특별실 ID
     */
    deleteRoom(roomId) {
        // 고정방은 삭제 금지
        if (this.isFixedRoomId(roomId)) return;
        const rooms = this.getRooms();
        const rid = String(roomId || '').trim();
        const filtered = rooms.filter(room => String(room?.id || '').trim() !== rid);
        this.saveRooms(filtered);
        
        // 해당 특별실의 예약도 모두 삭제
        const reservations = this.getReservations();
        const filteredReservations = reservations.filter(res => String(res?.roomId || '').trim() !== rid);
        this.saveReservations(filteredReservations);
    },

    /**
     * 예약 목록을 가져옵니다.
     * @returns {Array} 예약 배열
     */
    getReservations() {
        const data = localStorage.getItem(this.KEYS.RESERVATIONS);
        return data ? JSON.parse(data) : [];
    },

    /**
     * 예약 목록을 저장합니다.
     * @param {Array} reservations - 예약 배열
     */
    saveReservations(reservations) {
        const normalized = Array.isArray(reservations) ? reservations.map(r => this._normalizeReservation(r)).filter(Boolean) : [];
        localStorage.setItem(this.KEYS.RESERVATIONS, JSON.stringify(normalized));
    },

    /**
     * 새 예약을 추가합니다.
     * @param {Object} reservation - 예약 객체
     * @returns {Object} 생성된 예약 객체
     */
    addReservation(reservation) {
        const reservations = this.getReservations();
        const newReservation = {
            id: generateId('reservation'),
            ...reservation
        };
        reservations.push(newReservation);
        this.saveReservations(reservations);
        return newReservation;
    },

    /**
     * (마이그레이션) 특별실 ID가 중복된 경우 중복을 해소합니다.
     * - 첫 번째로 등장한 ID는 유지
     * - 같은 ID를 가진 나머지 방은 새 ID를 부여
     * - 기존 예약은 \"원래 ID(첫 방)\"에 그대로 남습니다 (과거 데이터가 이미 한 방으로 합쳐졌기 때문)
     * @returns {{changed: boolean, rooms: Array}}
     */
    ensureUniqueRoomIds() {
        const rooms = this.getRooms();
        const seen = new Set();
        let changed = false;

        for (const room of rooms) {
            if (!room) continue;
            const cur = String(room.id || '').trim();
            if (!cur) {
                room.id = generateId('room');
                changed = true;
                seen.add(String(room.id || '').trim());
            } else {
                // 타입/공백 정리 (number -> string 등)
                if (room.id !== cur) {
                    room.id = cur;
                    changed = true;
                }
                if (seen.has(cur)) {
                    room.id = generateId('room');
                    changed = true;
                }
                seen.add(String(room.id || '').trim());
            }
        }

        if (changed) {
            this.saveRooms(rooms);
        }

        return { changed, rooms };
    },

    /**
     * (마이그레이션) 예약 ID가 중복된 경우 중복을 해소합니다.
     * - 동일 id는 서버/클라이언트에서 서로 덮어써져 \"기존 예약이 사라짐\" 현상이 발생할 수 있음
     * @returns {{changed: boolean, reservations: Array}}
     */
    ensureUniqueReservationIds() {
        const reservations = this.getReservations();
        const seen = new Set();
        let changed = false;

        for (const r of reservations) {
            if (!r) continue;
            const cur = String(r.id || '').trim();
            if (!cur) {
                r.id = generateId('reservation');
                changed = true;
                seen.add(String(r.id || '').trim());
            } else {
                // 타입/공백 정리 (number -> string 등)
                if (r.id !== cur) {
                    r.id = cur;
                    changed = true;
                }
                if (seen.has(cur)) {
                    r.id = generateId('reservation');
                    changed = true;
                }
                seen.add(String(r.id || '').trim());
            }
        }

        if (changed) {
            this.saveReservations(reservations);
        }

        return { changed, reservations };
    },

    /**
     * 예약을 업데이트합니다.
     * @param {string} reservationId - 예약 ID
     * @param {Object} updates - 업데이트할 필드들
     */
    updateReservation(reservationId, updates) {
        const reservations = this.getReservations();
        const rid = String(reservationId || '').trim();
        const index = reservations.findIndex(res => String(res?.id || '').trim() === rid);
        if (index !== -1) {
            reservations[index] = { ...reservations[index], ...updates };
            this.saveReservations(reservations);
            return reservations[index];
        }
        return null;
    },

    /**
     * 예약을 삭제합니다.
     * @param {string} reservationId - 예약 ID
     */
    deleteReservation(reservationId) {
        const reservations = this.getReservations();
        const rid = String(reservationId || '').trim();
        const filtered = reservations.filter(res => String(res?.id || '').trim() !== rid);
        this.saveReservations(filtered);
    },

    /**
     * 특정 특별실의 예약 목록을 가져옵니다.
     * @param {string} roomId - 특별실 ID
     * @returns {Array} 예약 배열
     */
    getReservationsByRoom(roomId) {
        const reservations = this.getReservations();
        const rid = String(roomId || '').trim();
        return reservations.filter(res => String(res?.roomId || '').trim() === rid);
    },

    /**
     * 특정 날짜와 교시의 예약을 가져옵니다.
     * @param {string} roomId - 특별실 ID
     * @param {string} date - 날짜 (YYYY-MM-DD)
     * @param {string|number} period - 교시/슬롯 (예: 1~10 또는 "4E", "LUNCH_M")
     * @returns {Object|null} 예약 객체 또는 null
     */
    getReservation(roomId, date, period) {
        const reservations = this.getReservations();
        const rid = String(roomId || '').trim();
        const d = this._normalizeDateISO(date);
        const p = this._normalizePeriodKey(period);

        return reservations.find(res => {
            if (!res) return false;
            const resRoomId = String(res.roomId || '').trim();
            const resDate = this._normalizeDateISO(res.date);
            const resPeriod = this._normalizePeriodKey(res.period);
            return resRoomId === rid && resDate === d && resPeriod === p;
        }) || null;
    },

    /**
     * 모든 데이터를 초기화합니다.
     */
    clearAll() {
        localStorage.removeItem(this.KEYS.ROOMS);
        localStorage.removeItem(this.KEYS.RESERVATIONS);
    }

    ,

    /**
     * ---- Normalization helpers ----
     * Google Sheets / Apps Script에서 내려오는 값은
     * - 숫자/문자 혼용(period: 1 vs "1")
     * - 날짜 혼용(date: "YYYY-MM-DD" vs Date 객체 vs "YYYY-MM-DDTHH:mm:ssZ")
     * - 키 이름 흔들림(roomId vs roomID, createdAt vs createAt)
     * 등이 발생할 수 있어, 로컬에 저장하기 전에 표준 형태로 보정합니다.
     */

    _normalizeRoom(room) {
        if (!room) return null;
        const out = { ...room };
        const id = String(out.id || '').trim() || generateId('room');
        out.id = id;
        if (out.name != null) out.name = String(out.name).trim();
        return out;
    },

    _normalizeReservation(resv) {
        if (!resv) return null;

        // 원본 보존 + 표준 키로 보정
        const out = { ...resv };

        // id
        out.id = String(out.id || '').trim() || generateId('reservation');

        // roomId (roomID 호환)
        if (!out.roomId && out.roomID) out.roomId = out.roomID;
        out.roomId = String(out.roomId || '').trim();

        // date (표준: YYYY-MM-DD)
        out.date = this._normalizeDateISO(out.date);

        // period (표준: number)
        // - 기존 데이터는 1~10 숫자/문자
        // - 확장 슬롯은 "4E", "LUNCH_M" 같은 문자열을 사용
        out.period = this._normalizePeriodKey(out.period);

        // 문자열 필드
        if (out.name != null) out.name = String(out.name).trim();
        if (out.class != null) out.class = String(out.class).trim();
        if (out.purpose != null) out.purpose = String(out.purpose).trim();

        // createdAt/createAt 호환(키만 맞춰두고 값은 그대로 둠)
        if (!out.createdAt && out.createAt) out.createdAt = out.createAt;

        return out;
    },

    /**
     * 교시/슬롯 키를 비교 가능한 문자열로 정규화합니다.
     * - 1, "1", "01" -> "1"
     * - "4E", "LUNCH_M" -> 그대로(trim만)
     * @param {any} value
     * @returns {string}
     */
    _normalizePeriodKey(value) {
        if (value == null) return '';
        const s = String(value).trim();
        if (!s) return '';
        const n = Number(s);
        if (Number.isFinite(n) && String(n) === String(parseInt(String(n), 10))) {
            return String(n);
        }
        return s;
    },

    /**
     * date를 "YYYY-MM-DD"로 최대한 보정합니다.
     * - Date 객체: formatDateISO 사용
     * - ISO 문자열: 앞 10자리 사용(YYYY-MM-DD)
     * - "YYYY.M.D" / "YYYY-MM-D" 등: 패딩해서 ISO로 변환
     */
    _normalizeDateISO(value) {
        if (value == null) return '';

        // Date 객체
        if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime?.())) {
            try {
                return formatDateISO(value);
            } catch (_) {
                // fallthrough
            }
        }

        const s = String(value).trim();
        if (!s) return '';

        // "2026-01-08T00:00:00.000Z" 같은 ISO는 그대로 slice하면(UTC 기준) 날짜가 하루 밀릴 수 있습니다.
        // 반드시 Date로 파싱한 뒤, 로컬 타임존 기준으로 YYYY-MM-DD로 변환합니다.
        if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
            const d = new Date(s);
            if (!isNaN(d.getTime())) {
                return formatDateISO(d);
            }
            // 파싱 실패 시 최소한 앞 10자리 사용
            return s.slice(0, 10);
        }

        // 이미 ISO
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

        // 기타 Date 문자열(예: "Thu Jan 08 2026 00:00:00 GMT+0900 ...")도 파싱 시도
        // (Sheets가 날짜를 Date로 저장했다가 문자열로 내려줄 때 발생 가능)
        if (/[A-Za-z]{3}\s+[A-Za-z]{3}\s+\d{1,2}\s+\d{4}/.test(s) || /GMT[+-]\d{4}/.test(s)) {
            const d = new Date(s);
            if (!isNaN(d.getTime())) {
                return formatDateISO(d);
            }
        }

        // 점/슬래시 포함 포맷도 보정
        const m = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/);
        if (m) {
            const yyyy = m[1];
            const mm = String(m[2]).padStart(2, '0');
            const dd = String(m[3]).padStart(2, '0');
            return `${yyyy}-${mm}-${dd}`;
        }

        // 마지막 fallback: 그대로(이 경우 getReservation에서 매칭이 어려울 수 있어, 가능한 표준화 권장)
        return s;
    }
};

