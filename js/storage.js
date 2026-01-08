/**
 * 로컬 스토리지 관리 모듈
 */

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
        localStorage.setItem(this.KEYS.ROOMS, JSON.stringify(rooms));
    },

    /**
     * 새 특별실을 추가합니다.
     * @param {string} name - 특별실 이름
     * @returns {Object} 생성된 특별실 객체
     */
    addRoom(name) {
        const rooms = this.getRooms();
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
        const rooms = this.getRooms();
        const filtered = rooms.filter(room => room.id !== roomId);
        this.saveRooms(filtered);
        
        // 해당 특별실의 예약도 모두 삭제
        const reservations = this.getReservations();
        const filteredReservations = reservations.filter(res => res.roomId !== roomId);
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
        localStorage.setItem(this.KEYS.RESERVATIONS, JSON.stringify(reservations));
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
            if (!room.id) {
                room.id = generateId('room');
                changed = true;
            }
            if (seen.has(room.id)) {
                room.id = generateId('room');
                changed = true;
            }
            seen.add(room.id);
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
            if (!r.id) {
                r.id = generateId('reservation');
                changed = true;
            }
            if (seen.has(r.id)) {
                r.id = generateId('reservation');
                changed = true;
            }
            seen.add(r.id);
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
        const index = reservations.findIndex(res => res.id === reservationId);
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
        const filtered = reservations.filter(res => res.id !== reservationId);
        this.saveReservations(filtered);
    },

    /**
     * 특정 특별실의 예약 목록을 가져옵니다.
     * @param {string} roomId - 특별실 ID
     * @returns {Array} 예약 배열
     */
    getReservationsByRoom(roomId) {
        const reservations = this.getReservations();
        return reservations.filter(res => res.roomId === roomId);
    },

    /**
     * 특정 날짜와 교시의 예약을 가져옵니다.
     * @param {string} roomId - 특별실 ID
     * @param {string} date - 날짜 (YYYY-MM-DD)
     * @param {number} period - 교시 (1~10)
     * @returns {Object|null} 예약 객체 또는 null
     */
    getReservation(roomId, date, period) {
        const reservations = this.getReservations();
        return reservations.find(res => 
            res.roomId === roomId && 
            res.date === date && 
            res.period === period
        ) || null;
    },

    /**
     * 모든 데이터를 초기화합니다.
     */
    clearAll() {
        localStorage.removeItem(this.KEYS.ROOMS);
        localStorage.removeItem(this.KEYS.RESERVATIONS);
    }
};

