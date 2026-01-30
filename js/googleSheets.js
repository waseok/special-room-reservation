/**
 * Apps Script Web App + Google Sheet 연동 모듈
 *
 * 핵심 아이디어:
 * - 프론트(이 웹앱)는 GitHub Pages/Vercel 같은 정적 호스팅에 올립니다.
 * - 데이터 저장/조회는 Apps Script Web App(=서버 역할)이 스프레드시트를 읽고/씁니다.
 *
 * 장점:
 * - Google Cloud API 키를 프론트에 노출하지 않아도 됨
 * - 서버를 별도로 운영할 필요 없음
 *
 * 주의:
 * - \"로그인 없이 누구나\" 접근이면 데이터 변경도 누구나 가능해질 수 있습니다.
 *   -> 현재 앱은 수정/삭제에 공통 비밀번호(8714)로 최소 방어를 하고 있습니다.
 */

const GoogleSheets = {
    // 설정 (사용자가 직접 입력해야 함)
    config: {
        webAppUrl: '', // Apps Script 웹앱 배포 URL
        enabled: false, // API 연동 활성화 여부
        // 자동 동기화 옵션을 분리(저장/불러오기 개별 on/off)
        // - 과거 설정(autoSync)을 사용하던 사용자를 위해 loadConfig에서 호환 처리합니다.
        autoSave: true, // 입력 시 자동 저장(push)
        autoPull: true, // 주기적 자동 불러오기(pull)
        pollSeconds: 20 // 자동 불러오기 주기(초)
    },

    /**
     * 설정을 로컬 스토리지에서 로드합니다.
     */
    loadConfig() {
        const saved = localStorage.getItem('googleSheetsConfig');
        if (saved) {
            const parsed = JSON.parse(saved) || {};
            // backward compatibility: autoSync -> autoSave/autoPull
            if (typeof parsed.autoSync === 'boolean') {
                if (typeof parsed.autoSave !== 'boolean') parsed.autoSave = parsed.autoSync;
                if (typeof parsed.autoPull !== 'boolean') parsed.autoPull = parsed.autoSync;
            }
            this.config = { ...this.config, ...parsed };
        }

        // 저장된 설정이 없거나 webAppUrl이 비어있으면 "배포에 박아둔 기본 URL" 또는 URL 쿼리로 주입된 값을 사용합니다.
        const bootUrl = this._getBootWebAppUrl();
        if (!this.config.webAppUrl && bootUrl) {
            this.config.webAppUrl = bootUrl;
            // URL이 있으면 기본적으로 활성화
            this.config.enabled = true;
            this.saveConfig();
        }
    },

    _isLocked() {
        return typeof window !== 'undefined' && window.APP_LOCK_SERVER_URL === true;
    },

    _getBootWebAppUrl() {
        try {
            // 1) 쿼리 파라미터로 주입 (?server=... 또는 ?webAppUrl=...)
            const url = new URL(window.location.href);
            const qp = (url.searchParams.get('server') || url.searchParams.get('webAppUrl') || '').trim();
            if (qp) return qp;
        } catch (_) {
            // ignore
        }
        // 2) index.html에 박아둔 기본값
        const fromWindow = (typeof window !== 'undefined' && window.APP_DEFAULT_WEBAPP_URL) ? String(window.APP_DEFAULT_WEBAPP_URL).trim() : '';
        return fromWindow || '';
    },

    /**
     * 설정을 저장합니다.
     */
    saveConfig() {
        localStorage.setItem('googleSheetsConfig', JSON.stringify(this.config));
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
                <h2 class="text-xl font-bold mb-4">서버(Apps Script) 설정</h2>
                <form id="googleSheetsConfigForm">
                    <div class="mb-4">
                        <label class="block text-sm font-medium mb-1">Apps Script Web App URL</label>
                        <input type="text" id="gsWebAppUrl" class="w-full px-3 py-2 border rounded"
                               value="${this.config.webAppUrl}" placeholder="https://script.google.com/macros/s/.../exec" ${locked ? 'disabled' : ''}>
                        <p class="text-xs text-gray-500 mt-1">
                            ${locked ? '이 배포는 서버 URL이 고정되어 있어 변경할 수 없습니다.' : 'Apps Script에서 \"배포\" → \"웹 앱\"으로 배포한 URL을 붙여넣으세요.'}
                        </p>
                    </div>
                    <div class="mb-4">
                        <label class="flex items-center">
                            <input type="checkbox" id="gsEnabled" ${this.config.enabled ? 'checked' : ''} 
                                   class="mr-2" ${locked ? 'disabled' : ''}>
                            <span>서버 연동 활성화</span>
                        </label>
                    </div>
                    <div class="mb-4">
                        <div class="space-y-2">
                            <label class="flex items-center">
                                <input type="checkbox" id="gsAutoSave" ${this.config.autoSave ? 'checked' : ''} 
                                       class="mr-2">
                                <span>자동 저장(입력 시 서버로 저장)</span>
                            </label>
                            <label class="flex items-center">
                                <input type="checkbox" id="gsAutoPull" ${this.config.autoPull ? 'checked' : ''} 
                                       class="mr-2">
                                <span>자동 불러오기(주기적으로 서버에서 가져오기)</span>
                            </label>
                        </div>
                        <div class="mt-2 flex items-center gap-2">
                            <span class="text-xs text-gray-600">자동 불러오기 주기</span>
                            <select id="gsPollSeconds" class="px-2 py-1 border rounded text-xs">
                                ${[10, 20, 30, 60].map(s => `<option value="${s}" ${Number(this.config.pollSeconds) === s ? 'selected' : ''}>${s}초</option>`).join('')}
                            </select>
                        </div>
                    </div>
                    <div class="mb-4 border-t pt-3">
                        <div class="text-xs text-gray-600 mb-2">
                            관리자/복구 기능
                        </div>
                        <div class="flex gap-2 justify-end">
                            <button type="button" id="gsRepairBtn" class="px-3 py-2 bg-red-600 text-white rounded hover:bg-red-700 text-sm">
                                서버 데이터 정리
                            </button>
                            <button type="button" id="gsLocalResetBtn" class="px-3 py-2 bg-gray-200 rounded hover:bg-gray-300 text-sm">
                                이 PC 데이터 초기화
                            </button>
                        </div>
                        <div class="text-[11px] text-gray-500 mt-2 leading-relaxed">
                            - 서버 데이터 정리: 시트의 빈/중복 id 행, 고정 특별실 중복 등을 정리합니다(주의: 일부 행 삭제 가능).<br>
                            - 이 PC 데이터 초기화: 내 브라우저(LocalStorage)만 초기화합니다(서버 데이터는 유지).
                        </div>
                    </div>
                    <div class="flex gap-2 justify-end">
                        <button type="button" id="gsCancelBtn" class="px-4 py-2 bg-gray-300 rounded hover:bg-gray-400">
                            취소
                        </button>
                        <button type="button" id="gsTestBtn" class="px-4 py-2 bg-gray-900 text-white rounded hover:bg-gray-800">
                            연결 테스트
                        </button>
                        <button type="submit" class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
                            저장
                        </button>
                    </div>
                </form>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        const form = modal.querySelector('#googleSheetsConfigForm');
        const cancelBtn = modal.querySelector('#gsCancelBtn');
        const testBtn = modal.querySelector('#gsTestBtn');
        const repairBtn = modal.querySelector('#gsRepairBtn');
        const localResetBtn = modal.querySelector('#gsLocalResetBtn');
        
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            // 잠금 상태면 URL/활성화 여부는 배포자가 정한 값 유지
            if (!locked) {
                this.config.webAppUrl = modal.querySelector('#gsWebAppUrl').value.trim();
                this.config.enabled = modal.querySelector('#gsEnabled').checked;
            }
            this.config.autoSave = modal.querySelector('#gsAutoSave').checked;
            this.config.autoPull = modal.querySelector('#gsAutoPull').checked;
            this.config.pollSeconds = Number(modal.querySelector('#gsPollSeconds').value || 20);
            this.saveConfig();
            document.body.removeChild(modal);
            alert('설정이 저장되었습니다.');

            // 저장 후 자동 동기화 재시작
            this.stopAutoSync?.();
            this.startAutoSync?.();
        });

        testBtn.addEventListener('click', async () => {
            const url = modal.querySelector('#gsWebAppUrl').value.trim();
            if (!url) {
                alert('Web App URL을 입력해주세요.');
                return;
            }
            try {
                const data = await this.exportAll(url);
                if (!data || !Array.isArray(data.rooms) || !Array.isArray(data.reservations)) {
                    throw new Error('응답 형식이 올바르지 않습니다.');
                }
                alert(`연결 성공! Rooms: ${data.rooms.length}개, Reservations: ${data.reservations.length}개`);
            } catch (err) {
                console.error(err);
                alert('연결 실패: ' + (err?.message || err));
            }
        });

        repairBtn.addEventListener('click', async () => {
            const url = modal.querySelector('#gsWebAppUrl').value.trim();
            if (!url) {
                alert('Web App URL이 없습니다.');
                return;
            }
            if (!confirm('정말로 서버(시트) 데이터를 정리하시겠습니까?\n- 중복/빈 id 행이 삭제될 수 있습니다.\n- 고정 특별실은 1개로 통합됩니다.')) {
                return;
            }
            const pw = prompt('관리자 비밀번호(4자리)를 입력하세요:');
            if (pw === null) return;
            try {
                const res = await this.repairServer(url, pw);
                if (!res?.ok) {
                    alert('정리 실패: ' + (res?.error || 'unknown'));
                    return;
                }
                const s = res?.summary || {};
                alert(
                    '서버 정리 완료!\n' +
                    `- Rooms: removedRows=${s?.rooms?.removedRows ?? 0}, mergedByName=${s?.rooms?.mergedByName ?? 0}\n` +
                    `- Reservations: removedRows=${s?.reservations?.removedRows ?? 0}, remappedRoomId=${s?.reservations?.remappedRoomId ?? 0}`
                );

                // 정리 후 최신 데이터 다시 pull(화면 반영)
                const v = res?.meta?.version || '';
                if (v) this._setLastVersion(v);
                await this.pullIfChanged();
            } catch (err) {
                console.error(err);
                alert('정리 중 오류: ' + (err?.message || err));
            }
        });

        localResetBtn.addEventListener('click', () => {
            if (!confirm('이 PC(브라우저)에 저장된 데이터만 초기화할까요?\n서버(시트) 데이터는 삭제되지 않습니다.')) return;
            try {
                localStorage.removeItem('specialRooms');
                localStorage.removeItem('specialReservations');
                localStorage.removeItem('googleSheetsConfig');
                localStorage.removeItem('serverSyncVersion');
            } finally {
                alert('초기화했습니다. 페이지를 새로고침합니다.');
                location.reload();
            }
        });
        
        cancelBtn.addEventListener('click', () => {
            document.body.removeChild(modal);
        });
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                document.body.removeChild(modal);
            }
        });
    },

    /**
     * 로컬 데이터를 구글 스프레드시트에 동기화합니다.
     */
    async syncToSheets() {
        if (!this.config.enabled || !this.config.webAppUrl) {
            alert('서버 설정이 완료되지 않았습니다.');
            return;
        }

        try {
            const rooms = Storage.getRooms();
            const reservations = Storage.getReservations();
            const hints = (typeof window !== 'undefined' && typeof window.AppHints?.exportAllHints === 'function')
                ? window.AppHints.exportAllHints()
                : [];
            await this.upsertAll(this.config.webAppUrl, { rooms, reservations, hints });
            alert('서버(구글 시트)에 저장되었습니다.');
        } catch (error) {
            console.error('동기화 오류:', error);
            alert('동기화 중 오류가 발생했습니다: ' + error.message);
        }
    },

    /**
     * 구글 스프레드시트에서 데이터를 가져옵니다.
     */
    async syncFromSheets() {
        if (!this.config.enabled || !this.config.webAppUrl) {
            alert('서버 설정이 완료되지 않았습니다.');
            return;
        }

        if (!confirm('서버(구글 시트)의 데이터로 현재 데이터를 덮어쓰시겠습니까?')) {
            return;
        }

        try {
            const data = await this.exportAll(this.config.webAppUrl);
            if (data.rooms) Storage.saveRooms(data.rooms);
            if (data.reservations) Storage.saveReservations(data.reservations);
            // 기본 배정(힌트)도 함께 적용(여러 PC/브라우저 공유)
            if (typeof window !== 'undefined' && typeof window.AppHints?.applyHintsFromServer === 'function') {
                window.AppHints.applyHintsFromServer(data.hints || []);
            }

            // 불러오기 후: 고정방 강제 + 중복 정리 + 예약 roomId 마이그레이션
            Storage.ensureFixedRooms?.();
            Storage.ensureUniqueRoomIds?.();
            Storage.ensureUniqueReservationIds?.();

            alert('서버(구글 시트)에서 데이터를 불러왔습니다. 페이지를 새로고침합니다.');
            location.reload();
        } catch (error) {
            console.error('동기화 오류:', error);
            alert('동기화 중 오류가 발생했습니다: ' + error.message);
        }
    },

    /**
     * 서버에서 전체 데이터(export)를 가져옵니다.
     * @param {string} webAppUrl
     * @returns {Promise<{rooms:Array,reservations:Array}>}
     */
    async exportAll(webAppUrl) {
        const url = `${webAppUrl}?action=export`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    },

    /**
     * 서버에 전체 데이터(upsertAll)를 저장합니다.
     * - CORS preflight를 피하기 위해 form-urlencoded로 보냅니다.
     * @param {string} webAppUrl
     * @param {{rooms:Array,reservations:Array}} payload
     */
    async upsertAll(webAppUrl, payload) {
        const body = new URLSearchParams();
        body.set('action', 'upsertAll');
        body.set('payload', JSON.stringify(payload));

        const res = await fetch(webAppUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
            body
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    },

    async upsertRoom(webAppUrl, room) {
        const body = new URLSearchParams();
        body.set('action', 'upsertRoom');
        body.set('payload', JSON.stringify(room));
        const res = await fetch(webAppUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
            body
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    },

    async upsertReservation(webAppUrl, reservation) {
        const body = new URLSearchParams();
        body.set('action', 'upsertReservation');
        body.set('payload', JSON.stringify(reservation));
        const res = await fetch(webAppUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
            body
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    },

    async deleteReservation(webAppUrl, id) {
        const body = new URLSearchParams();
        body.set('action', 'deleteReservation');
        body.set('id', id);
        const res = await fetch(webAppUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
            body
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    },

    async deleteRoom(webAppUrl, id) {
        const body = new URLSearchParams();
        body.set('action', 'deleteRoom');
        body.set('id', id);
        const res = await fetch(webAppUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
            body
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    },

    async upsertHint(webAppUrl, hint) {
        const body = new URLSearchParams();
        body.set('action', 'upsertHint');
        body.set('payload', JSON.stringify(hint));
        const res = await fetch(webAppUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
            body
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    },

    async deleteHint(webAppUrl, id) {
        const body = new URLSearchParams();
        body.set('action', 'deleteHint');
        body.set('id', id);
        const res = await fetch(webAppUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
            body
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    },

    /**
     * 서버(시트) 자체를 정리하는 관리자용 기능
     * - Rooms/Reservations의 빈 id, 중복 id, 고정 특별실 중복 등을 서버에서 직접 정리합니다.
     * - 최소 방어로 공통 비밀번호(8714)를 요구합니다.
     */
    async repairServer(webAppUrl, password) {
        const body = new URLSearchParams();
        body.set('action', 'repair');
        body.set('password', String(password || ''));
        const res = await fetch(webAppUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
            body
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    },

    // ---- Auto sync ----
    _autoSyncTimer: null,
    _applyRemote: null,
    _focusHandler: null,
    _visibilityHandler: null,

    setApplyRemote(fn) {
        this._applyRemote = fn;
    },

    _getLastVersion() {
        return localStorage.getItem('serverSyncVersion') || '';
    },

    _setLastVersion(v) {
        if (v) localStorage.setItem('serverSyncVersion', v);
    },

    isReady() {
        return !!(this.config.enabled && this.config.webAppUrl);
    },

    startAutoSync() {
        if (!this.isReady() || !this.config.autoPull) return;

        // 재시작 시(설정 저장 등) 이벤트 리스너/타이머가 중복 누적되는 것을 방지
        this.stopAutoSync();

        const pollMs = Math.max(5, Number(this.config.pollSeconds) || 20) * 1000;

        // 주기적 pull
        this._autoSyncTimer = setInterval(() => {
            this.pullIfChanged().catch(console.error);
        }, pollMs);

        // 포커스/복귀 시 pull
        this._focusHandler = () => this.pullIfChanged().catch(console.error);
        this._visibilityHandler = () => {
            if (document.visibilityState === 'visible') {
                this.pullIfChanged().catch(console.error);
            }
        };
        window.addEventListener('focus', this._focusHandler);
        document.addEventListener('visibilitychange', this._visibilityHandler);

        // 시작 즉시 1회
        this.pullIfChanged().catch(console.error);
    },

    stopAutoSync() {
        if (this._autoSyncTimer) {
            clearInterval(this._autoSyncTimer);
            this._autoSyncTimer = null;
        }
        // startAutoSync에서 붙인 리스너 제거(중복 pull 방지)
        if (this._focusHandler) {
            window.removeEventListener('focus', this._focusHandler);
            this._focusHandler = null;
        }
        if (this._visibilityHandler) {
            document.removeEventListener('visibilitychange', this._visibilityHandler);
            this._visibilityHandler = null;
        }
    },

    async pullIfChanged() {
        if (!this.isReady() || !this._applyRemote) return;
        // 저장(flush) 중에는 pull로 화면이 흔들리거나 \"사라짐\"처럼 보일 수 있어 잠시 중단
        if (this._isFlushing) return;
        const data = await this.exportAll(this.config.webAppUrl);
        if (!data || !data.ok) return;

        // 방어: export 응답이 비정상(배열이 아닌 경우)일 때는 적용하지 않음
        // (네트워크/서버 오류로 {}만 내려오면 local이 \"사라진 것처럼\" 보일 수 있음)
        if (data.rooms != null && !Array.isArray(data.rooms)) return;
        if (data.reservations != null && !Array.isArray(data.reservations)) return;
        if (data.hints != null && !Array.isArray(data.hints)) return;

        const serverV = data?.meta?.version || '';
        const lastV = this._getLastVersion();
        if (serverV && serverV !== lastV) {
            this._setLastVersion(serverV);
            await this._applyRemote({ rooms: data.rooms || [], reservations: data.reservations || [], hints: data.hints || [] });
        }
    },

    // 입력(변경) 트리거 시 자동 저장(디바운스)
    _saveTimer: null,
    _saveQueue: [],

    queueSave(task) {
        if (!this.isReady() || !this.config.autoSave) return;
        this._saveQueue.push(task);
        if (this._saveTimer) clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => this.flushSaveQueue().catch(console.error), 600);
    },

    async flushSaveQueue() {
        if (!this.isReady()) return;
        const tasks = this._saveQueue.splice(0, this._saveQueue.length);
        if (tasks.length === 0) return;
        this._isFlushing = true;

        // 같은 종류/ID는 마지막 작업만 남김
        const map = new Map();
        for (const t of tasks) {
            const key = `${t.type}:${t.id || ''}`;
            map.set(key, t);
        }
        const compact = Array.from(map.values());

        try {
            for (const t of compact) {
                if (t.type === 'upsertRoom') await this.upsertRoom(this.config.webAppUrl, t.data);
                if (t.type === 'upsertReservation') await this.upsertReservation(this.config.webAppUrl, t.data);
                if (t.type === 'deleteRoom') await this.deleteRoom(this.config.webAppUrl, t.id);
                if (t.type === 'deleteReservation') await this.deleteReservation(this.config.webAppUrl, t.id);
                if (t.type === 'upsertHint') await this.upsertHint(this.config.webAppUrl, t.data);
                if (t.type === 'deleteHint') await this.deleteHint(this.config.webAppUrl, t.id);
            }

            // 저장 후 서버 버전 갱신(다음 pull 비교에 사용)
            const exported = await this.exportAll(this.config.webAppUrl);
            const serverV = exported?.meta?.version || '';
            this._setLastVersion(serverV);
        } finally {
            this._isFlushing = false;
        }
    }
};

// 설정 로드
GoogleSheets.loadConfig();
