/**
 * Supabase 연동 모듈 (구글시트+Apps Script를 대체)
 *
 * - 프론트(정적 호스팅)에서 Supabase JS 클라이언트로 직접 Postgres에 접속합니다.
 * - 폴링 대신 Realtime 구독으로 변경 사항을 즉시 반영합니다(끊기는 경우를 대비해 느린 주기의 안전망 폴링도 유지).
 * - 중복 예약 방지(같은 방/날짜/교시)는 DB의 UNIQUE 제약(reservations_room_date_period_unique)이
 *   담당하므로, 예전처럼 클라이언트가 직접 정리(repair)할 필요가 없습니다.
 *
 * 주의:
 * - 로그인 없이 누구나 접근 가능한 구조는 기존과 동일합니다(수정/삭제는 공통 비밀번호로 최소 방어).
 */

const SupabaseSync = {
    config: {
        url: '',
        key: '',
        enabled: false,
        autoSave: true,
        autoPull: true, // 안전망 폴링 on/off (Realtime이 정상 동작하면 거의 안 쓰임)
        pollSeconds: 60
    },

    _client: null,

    loadConfig() {
        const saved = localStorage.getItem('supabaseConfig');
        if (saved) {
            try {
                this.config = { ...this.config, ...(JSON.parse(saved) || {}) };
            } catch (_) {
                // ignore
            }
        }

        const boot = this._getBootConfig();
        if (!this.config.url && boot.url) this.config.url = boot.url;
        if (!this.config.key && boot.key) this.config.key = boot.key;
        if ((boot.url || boot.key) && this.config.url && this.config.key) {
            this.config.enabled = true;
            this.saveConfig();
        }

        this._initClient();
    },

    _isLocked() {
        return typeof window !== 'undefined' && window.APP_LOCK_SERVER_URL === true;
    },

    _getBootConfig() {
        let qpUrl = '';
        let qpKey = '';
        try {
            const u = new URL(window.location.href);
            qpUrl = (u.searchParams.get('supabaseUrl') || '').trim();
            qpKey = (u.searchParams.get('supabaseKey') || '').trim();
        } catch (_) {
            // ignore
        }
        const winUrl = (typeof window !== 'undefined' && window.APP_DEFAULT_SUPABASE_URL) ? String(window.APP_DEFAULT_SUPABASE_URL).trim() : '';
        const winKey = (typeof window !== 'undefined' && window.APP_DEFAULT_SUPABASE_KEY) ? String(window.APP_DEFAULT_SUPABASE_KEY).trim() : '';
        return { url: qpUrl || winUrl, key: qpKey || winKey };
    },

    saveConfig() {
        localStorage.setItem('supabaseConfig', JSON.stringify(this.config));
    },

    _initClient() {
        if (!this.config.url || !this.config.key) {
            this._client = null;
            return;
        }
        if (typeof window === 'undefined' || !window.supabase || typeof window.supabase.createClient !== 'function') {
            console.error('Supabase 클라이언트 라이브러리가 로드되지 않았습니다.');
            this._client = null;
            return;
        }
        this._client = window.supabase.createClient(this.config.url, this.config.key);
    },

    isReady() {
        return !!(this.config.enabled && this.config.url && this.config.key && this._client);
    },

    /**
     * 설정 UI를 표시합니다.
     */
    showConfigModal() {
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
        const locked = this._isLocked();
        modal.innerHTML = `
            <div class="bg-white rounded-lg p-6 w-full max-w-md mx-4">
                <h2 class="text-xl font-bold mb-4">서버(Supabase) 설정</h2>
                <form id="sbConfigForm">
                    <div class="mb-4">
                        <label class="block text-sm font-medium mb-1">Supabase Project URL</label>
                        <input type="text" id="sbUrl" class="w-full px-3 py-2 border rounded"
                               value="${this.config.url}" placeholder="https://xxxx.supabase.co" ${locked ? 'disabled' : ''}>
                    </div>
                    <div class="mb-4">
                        <label class="block text-sm font-medium mb-1">Publishable(anon) key</label>
                        <input type="text" id="sbKey" class="w-full px-3 py-2 border rounded"
                               value="${this.config.key}" placeholder="sb_publishable_..." ${locked ? 'disabled' : ''}>
                        <p class="text-xs text-gray-500 mt-1">
                            ${locked ? '이 배포는 서버 설정이 고정되어 있어 변경할 수 없습니다.' : 'service_role(비밀) 키가 아니라 publishable/anon 키를 입력하세요.'}
                        </p>
                    </div>
                    <div class="mb-4">
                        <label class="flex items-center">
                            <input type="checkbox" id="sbEnabled" ${this.config.enabled ? 'checked' : ''}
                                   class="mr-2" ${locked ? 'disabled' : ''}>
                            <span>서버 연동 활성화</span>
                        </label>
                    </div>
                    <div class="mb-4">
                        <label class="flex items-center">
                            <input type="checkbox" id="sbAutoPull" ${this.config.autoPull ? 'checked' : ''} class="mr-2">
                            <span>안전망 폴링(Realtime이 끊겼을 때 대비, ${this.config.pollSeconds}초 주기)</span>
                        </label>
                    </div>
                    <div class="mb-4 border-t pt-3">
                        <div class="text-xs text-gray-600 mb-2">이 PC 데이터 초기화</div>
                        <button type="button" id="sbLocalResetBtn" class="px-3 py-2 bg-gray-200 rounded hover:bg-gray-300 text-sm">
                            이 PC 데이터 초기화
                        </button>
                        <div class="text-[11px] text-gray-500 mt-2">내 브라우저(LocalStorage)만 초기화합니다(서버 데이터는 유지).</div>
                    </div>
                    <div class="flex gap-2 justify-end">
                        <button type="button" id="sbCancelBtn" class="px-4 py-2 bg-gray-300 rounded hover:bg-gray-400">취소</button>
                        <button type="button" id="sbTestBtn" class="px-4 py-2 bg-gray-900 text-white rounded hover:bg-gray-800">연결 테스트</button>
                        <button type="submit" class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">저장</button>
                    </div>
                </form>
            </div>
        `;

        document.body.appendChild(modal);

        const form = modal.querySelector('#sbConfigForm');
        const cancelBtn = modal.querySelector('#sbCancelBtn');
        const testBtn = modal.querySelector('#sbTestBtn');
        const localResetBtn = modal.querySelector('#sbLocalResetBtn');

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            if (!locked) {
                this.config.url = modal.querySelector('#sbUrl').value.trim();
                this.config.key = modal.querySelector('#sbKey').value.trim();
                this.config.enabled = modal.querySelector('#sbEnabled').checked;
            }
            this.config.autoPull = modal.querySelector('#sbAutoPull').checked;
            this.saveConfig();
            this._initClient();
            document.body.removeChild(modal);
            alert('설정이 저장되었습니다.');

            this.stopAutoSync?.();
            this.startAutoSync?.();
        });

        testBtn.addEventListener('click', async () => {
            const url = modal.querySelector('#sbUrl').value.trim();
            const key = modal.querySelector('#sbKey').value.trim();
            if (!url || !key) {
                alert('URL과 key를 입력해주세요.');
                return;
            }
            try {
                const client = window.supabase.createClient(url, key);
                const { error, count } = await client.from('rooms').select('id', { count: 'exact', head: true });
                if (error) throw error;
                alert(`연결 성공! Rooms 테이블 접근 가능 (count=${count ?? '?'})`);
            } catch (err) {
                console.error(err);
                alert('연결 실패: ' + (err?.message || err));
            }
        });

        localResetBtn.addEventListener('click', () => {
            if (!confirm('이 PC(브라우저)에 저장된 데이터만 초기화할까요?\n서버(Supabase) 데이터는 삭제되지 않습니다.')) return;
            try {
                localStorage.removeItem('specialRooms');
                localStorage.removeItem('specialReservations');
                localStorage.removeItem('supabaseConfig');
                localStorage.removeItem('roomHintById');
                localStorage.removeItem('roomBaseCellHints');
            } finally {
                alert('초기화했습니다. 페이지를 새로고침합니다.');
                location.reload();
            }
        });

        cancelBtn.addEventListener('click', () => document.body.removeChild(modal));
        modal.addEventListener('click', (e) => {
            if (e.target === modal) document.body.removeChild(modal);
        });
    },

    // ---- row <-> app object 매핑 ----
    _roomFromRow(row) {
        if (!row) return null;
        return {
            id: row.id,
            name: row.name,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    },

    _roomToRow(room) {
        return { id: String(room.id || ''), name: String(room.name || '') };
    },

    _resFromRow(row) {
        if (!row) return null;
        return {
            id: row.id,
            roomId: row.room_id,
            date: row.date,
            period: row.period,
            name: row.name || '',
            class: row.class || '',
            purpose: row.purpose || '',
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    },

    _resToRow(res) {
        return {
            id: String(res.id || ''),
            room_id: String(res.roomId || ''),
            date: res.date,
            period: String(res.period ?? ''),
            name: res.name || '',
            class: res.class || '',
            purpose: res.purpose || ''
        };
    },

    _hintFromRow(row) {
        if (!row) return null;
        const out = { id: row.id, kind: row.kind, roomId: row.room_id, text: row.text };
        if (row.kind === 'cell') {
            out.dayIndex = row.day_index;
            out.slotId = row.slot_id;
        }
        return out;
    },

    _hintToRow(hint) {
        return {
            id: String(hint.id || ''),
            kind: String(hint.kind || ''),
            room_id: String(hint.roomId || ''),
            day_index: hint.dayIndex != null ? Number(hint.dayIndex) : null,
            slot_id: hint.slotId != null ? String(hint.slotId) : null,
            text: String(hint.text || '')
        };
    },

    /**
     * 서버에서 전체 데이터를 가져옵니다.
     */
    async exportAll() {
        if (!this._client) throw new Error('Supabase 클라이언트가 초기화되지 않았습니다.');
        const [roomsRes, resRes, hintsRes] = await Promise.all([
            this._client.from('rooms').select('*'),
            this._client.from('reservations').select('*'),
            this._client.from('hints').select('*')
        ]);
        if (roomsRes.error) throw roomsRes.error;
        if (resRes.error) throw resRes.error;
        if (hintsRes.error) throw hintsRes.error;

        return {
            ok: true,
            rooms: (roomsRes.data || []).map(r => this._roomFromRow(r)),
            reservations: (resRes.data || []).map(r => this._resFromRow(r)),
            hints: (hintsRes.data || []).map(r => this._hintFromRow(r))
        };
    },

    async upsertRoom(room) {
        const { error } = await this._client.from('rooms').upsert(this._roomToRow(room));
        if (error) throw error;
        return { ok: true };
    },

    async deleteRoom(id) {
        const { error } = await this._client.from('rooms').delete().eq('id', id);
        if (error) throw error;
        return { ok: true };
    },

    async upsertReservation(reservation) {
        const { error } = await this._client.from('reservations').upsert(this._resToRow(reservation));
        if (error) throw error;
        return { ok: true };
    },

    async deleteReservation(id) {
        const { error } = await this._client.from('reservations').delete().eq('id', id);
        if (error) throw error;
        return { ok: true };
    },

    async upsertHint(hint) {
        const { error } = await this._client.from('hints').upsert(this._hintToRow(hint));
        if (error) throw error;
        return { ok: true };
    },

    async deleteHint(id) {
        const { error } = await this._client.from('hints').delete().eq('id', id);
        if (error) throw error;
        return { ok: true };
    },

    /**
     * 로컬 데이터를 Supabase에 통째로 올립니다("서버로 저장" 버튼).
     */
    async syncToSheets() {
        if (!this.isReady()) {
            alert('서버 설정이 완료되지 않았습니다.');
            return;
        }
        try {
            const rooms = Storage.getRooms();
            const reservations = Storage.getReservations();
            const hints = (typeof window !== 'undefined' && typeof window.AppHints?.exportAllHints === 'function')
                ? window.AppHints.exportAllHints()
                : [];

            if (rooms.length) {
                const { error } = await this._client.from('rooms').upsert(rooms.map(r => this._roomToRow(r)));
                if (error) throw error;
            }
            if (reservations.length) {
                const { error } = await this._client.from('reservations').upsert(reservations.map(r => this._resToRow(r)));
                if (error) throw error;
            }
            if (hints.length) {
                const { error } = await this._client.from('hints').upsert(hints.map(h => this._hintToRow(h)));
                if (error) throw error;
            }
            alert('서버(Supabase)에 저장되었습니다.');
        } catch (error) {
            console.error('동기화 오류:', error);
            alert('동기화 중 오류가 발생했습니다: ' + (error?.message || error));
        }
    },

    /**
     * Supabase의 데이터로 로컬을 덮어씁니다("서버에서 불러오기" 버튼).
     */
    async syncFromSheets() {
        if (!this.isReady()) {
            alert('서버 설정이 완료되지 않았습니다.');
            return;
        }
        if (!confirm('서버(Supabase)의 데이터로 현재 데이터를 덮어쓰시겠습니까?')) return;

        try {
            const data = await this.exportAll();
            if (data.rooms) Storage.saveRooms(data.rooms);
            if (data.reservations) Storage.saveReservations(data.reservations);
            if (typeof window !== 'undefined' && typeof window.AppHints?.applyHintsFromServer === 'function') {
                window.AppHints.applyHintsFromServer(data.hints || []);
            }

            Storage.ensureFixedRooms?.();
            Storage.ensureUniqueRoomIds?.();
            Storage.ensureUniqueReservationIds?.();

            alert('서버(Supabase)에서 데이터를 불러왔습니다. 페이지를 새로고침합니다.');
            location.reload();
        } catch (error) {
            console.error('동기화 오류:', error);
            alert('동기화 중 오류가 발생했습니다: ' + (error?.message || error));
        }
    },

    // ---- Auto sync (Realtime + 안전망 폴링) ----
    _applyRemote: null,
    _channel: null,
    _pollTimer: null,
    _pullDebounceTimer: null,
    _focusHandler: null,
    _visibilityHandler: null,
    _isFlushing: false,

    setApplyRemote(fn) {
        this._applyRemote = fn;
    },

    startAutoSync() {
        if (!this.isReady()) return;
        this.stopAutoSync();

        // 여러 변경 이벤트가 짧은 시간에 몰려도 pull은 한 번만 하도록 디바운스
        const pullSoon = () => {
            if (this._pullDebounceTimer) clearTimeout(this._pullDebounceTimer);
            this._pullDebounceTimer = setTimeout(() => this.pull().catch(console.error), 300);
        };

        this._channel = this._client
            .channel('special-room-reservation-sync')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, pullSoon)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, pullSoon)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'hints' }, pullSoon)
            .subscribe();

        // Realtime이 어떤 이유로든 끊겨도 데이터가 계속 최신으로 맞춰지도록 하는 안전망
        if (this.config.autoPull) {
            const pollMs = Math.max(20, Number(this.config.pollSeconds) || 60) * 1000;
            this._pollTimer = setInterval(() => this.pull().catch(console.error), pollMs);
        }

        this._focusHandler = () => this.pull().catch(console.error);
        this._visibilityHandler = () => {
            if (document.visibilityState === 'visible') this.pull().catch(console.error);
        };
        window.addEventListener('focus', this._focusHandler);
        document.addEventListener('visibilitychange', this._visibilityHandler);

        this.pull().catch(console.error);
    },

    stopAutoSync() {
        if (this._channel) {
            try { this._client?.removeChannel(this._channel); } catch (_) { /* ignore */ }
            this._channel = null;
        }
        if (this._pollTimer) {
            clearInterval(this._pollTimer);
            this._pollTimer = null;
        }
        if (this._pullDebounceTimer) {
            clearTimeout(this._pullDebounceTimer);
            this._pullDebounceTimer = null;
        }
        if (this._focusHandler) {
            window.removeEventListener('focus', this._focusHandler);
            this._focusHandler = null;
        }
        if (this._visibilityHandler) {
            document.removeEventListener('visibilitychange', this._visibilityHandler);
            this._visibilityHandler = null;
        }
    },

    async pull() {
        if (!this.isReady() || !this._applyRemote) return;
        if (this._isFlushing) return; // 저장 중엔 화면이 흔들리지 않게 잠시 미룸
        const data = await this.exportAll();
        await this._applyRemote({ rooms: data.rooms || [], reservations: data.reservations || [], hints: data.hints || [] });
    },

    // 입력(변경) 트리거 시 자동 저장(디바운스)
    _saveTimer: null,
    _saveQueue: [],

    queueSave(task) {
        if (!this.isReady() || !this.config.autoSave) return;
        this._saveQueue.push(task);
        if (this._saveTimer) clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => this.flushSaveQueue().catch(console.error), 400);
    },

    async flushSaveQueue() {
        if (!this.isReady()) return;
        const tasks = this._saveQueue.splice(0, this._saveQueue.length);
        if (tasks.length === 0) return;
        this._isFlushing = true;

        const map = new Map();
        for (const t of tasks) {
            const key = `${t.type}:${t.id || ''}`;
            map.set(key, t);
        }
        const compact = Array.from(map.values());

        let hadError = false;
        try {
            for (const t of compact) {
                try {
                    if (t.type === 'upsertRoom') await this.upsertRoom(t.data);
                    if (t.type === 'upsertReservation') await this.upsertReservation(t.data);
                    if (t.type === 'deleteRoom') await this.deleteRoom(t.id);
                    if (t.type === 'deleteReservation') await this.deleteReservation(t.id);
                    if (t.type === 'upsertHint') await this.upsertHint(t.data);
                    if (t.type === 'deleteHint') await this.deleteHint(t.id);
                } catch (err) {
                    // 예: 같은 방/날짜/교시 UNIQUE 제약 위반(중복 예약 시도) 등.
                    // 서버가 거부한 변경은 로컬에만 남아 화면이 서버와 어긋날 수 있으므로,
                    // 즉시 서버 최신 상태를 다시 받아와 스스로 바로잡습니다.
                    console.error('저장 실패:', t, err);
                    hadError = true;
                }
            }
        } finally {
            this._isFlushing = false;
        }

        if (hadError) {
            this.pull().catch(console.error);
        }
    }
};

SupabaseSync.loadConfig();
