/**
 * 메인 애플리케이션 로직
 */

// 전역 상태
const AppState = {
    currentRoomId: null,
    currentWeek: new Date(), // 현재 선택된 주의 기준 날짜
    reservations: [],
    rooms: [],
    draggedRoom: null // 드래그 중인 특별실
};

// 공통 비밀번호 (특별실 삭제 / 예약 수정·삭제)
const COMMON_PASSWORD = '8714';

// DOM 요소 참조
const elements = {
    // 상단 컨트롤
    prevWeekBtn: document.getElementById('prevWeek'),
    nextWeekBtn: document.getElementById('nextWeek'),
    weekSelector: document.getElementById('weekSelector'),
    goTodayBtn: document.getElementById('goToday'),
    viewMyReservationsBtn: document.getElementById('viewMyReservations'),
    googleSheetsConfigBtn: document.getElementById('googleSheetsConfigBtn'),
    syncToSheetsBtn: document.getElementById('syncToSheetsBtn'),
    syncFromSheetsBtn: document.getElementById('syncFromSheetsBtn'),
    
    // 탭 영역
    roomTabs: document.getElementById('roomTabs'),
    addRoomBtn: document.getElementById('addRoomBtn'),
    
    // 시간표
    scheduleTable: document.getElementById('scheduleTable'),
    scheduleTitle: document.getElementById('scheduleTitle'),
    scheduleBody: document.getElementById('scheduleBody'),
    monday: document.getElementById('monday'),
    tuesday: document.getElementById('tuesday'),
    wednesday: document.getElementById('wednesday'),
    thursday: document.getElementById('thursday'),
    friday: document.getElementById('friday'),
    
    // 모달
    reservationModal: document.getElementById('reservationModal'),
    addRoomModal: document.getElementById('addRoomModal'),
    editRoomModal: document.getElementById('editRoomModal'),
    reservationForm: document.getElementById('reservationForm'),
    addRoomForm: document.getElementById('addRoomForm'),
    editRoomForm: document.getElementById('editRoomForm'),
    modalTitle: document.getElementById('modalTitle'),
    reservationId: document.getElementById('reservationId'),
    reservationDate: document.getElementById('reservationDate'),
    reservationPeriod: document.getElementById('reservationPeriod'),
    reservationRoomId: document.getElementById('reservationRoomId'),
    reservationName: document.getElementById('reservationName'),
    reservationClass: document.getElementById('reservationClass'),
    reservationPurpose: document.getElementById('reservationPurpose'),
    deleteReservationBtn: document.getElementById('deleteReservationBtn'),
    cancelModalBtn: document.getElementById('cancelModalBtn'),
    cancelRoomModalBtn: document.getElementById('cancelRoomModalBtn'),
    cancelEditRoomModalBtn: document.getElementById('cancelEditRoomModalBtn'),
    roomName: document.getElementById('roomName'),
    editRoomId: document.getElementById('editRoomId'),
    editRoomName: document.getElementById('editRoomName')
};

// 예약 수정/삭제 권한(비번 확인 완료된 예약 ID)
let authorizedReservationId = null;

/**
 * 수정/삭제 같은 보호된 작업에 대해 공통 비밀번호 확인
 * @param {string} actionLabel
 * @returns {boolean}
 */
function requireCommonPassword(actionLabel) {
    const input = prompt(`${actionLabel}하려면 비밀번호(4자리)를 입력하세요:`);
    if (input === null) return false; // 취소
    if (input !== COMMON_PASSWORD) {
        alert('비밀번호가 올바르지 않습니다.');
        return false;
    }
    return true;
}

/**
 * 특별실별 예약 색상(투명도 포함)을 적용합니다.
 * - room 순서에 따라 색이 순환
 * - CSS 변수로 td 예약 셀 배경/글자색을 제어
 */
function applyRoomTheme(roomId) {
    if (!elements.scheduleTable) return;

    const idx = Math.max(0, AppState.rooms.findIndex(r => r.id === roomId));
    const palette = [
        // [bg, fg, subFg]
        ['rgba(59, 130, 246, 0.22)', '#0f172a', 'rgba(15, 23, 42, 0.75)'],   // blue
        ['rgba(34, 197, 94, 0.20)', '#052e16', 'rgba(5, 46, 22, 0.75)'],     // green
        ['rgba(168, 85, 247, 0.18)', '#2e1065', 'rgba(46, 16, 101, 0.75)'],  // purple
        ['rgba(249, 115, 22, 0.18)', '#431407', 'rgba(67, 20, 7, 0.75)'],    // orange
        ['rgba(20, 184, 166, 0.18)', '#042f2e', 'rgba(4, 47, 46, 0.75)'],    // teal
    ];

    const [bg, fg, subFg] = palette[idx % palette.length];
    elements.scheduleTable.style.setProperty('--reserved-bg', bg);
    elements.scheduleTable.style.setProperty('--reserved-fg', fg);
    elements.scheduleTable.style.setProperty('--reserved-sub-fg', subFg);
}

/**
 * 애플리케이션 초기화
 */
function init() {
    loadRooms();
    // 기본 특별실을 빠르게 연속 생성하면(같은 ms) ID가 겹칠 수 있어 중복을 정리합니다.
    // 중복 ID가 있으면 탭이 \"세트로 묶여\" 동작하는 것처럼 보입니다.
    Storage.ensureUniqueRoomIds();
    // 예약도 과거(Date.now 기반)에서 id가 겹치면 새 예약이 기존 예약을 덮어써서 \"삭제\"처럼 보일 수 있어 정리합니다.
    Storage.ensureUniqueReservationIds();
    loadRooms();
    loadReservations();

    // 고정 특별실(음악실/도서실/4층 회의실/1층 시청각실) 보장 + 중복 정리 + 예약 roomId 마이그레이션
    Storage.ensureFixedRooms?.();
    loadRooms();
    loadReservations();
    setupEventListeners();
    renderRoomTabs();
    updateWeekSelector();
    
    // 기본 특별실이 없으면 샘플 데이터 생성
    if (AppState.rooms.length === 0) {
        createDefaultRooms();
    }
    
    // 첫 번째 특별실 선택
    if (AppState.rooms.length > 0) {
        selectRoom(AppState.rooms[0].id);
    } else {
        renderSchedule();
    }

    // 서버 자동 동기화: 원격 데이터 적용 핸들러 등록 + 시작
    if (typeof GoogleSheets !== 'undefined') {
        GoogleSheets.setApplyRemote(async ({ rooms, reservations }) => {
            // 서버 데이터 적용: \"그냥 덮어쓰기\"는 위험합니다.
            // - Sheets/Apps Script 특성상 date/period 타입이 흔들리거나
            // - 헤더/빈값 때문에 원격 객체가 불완전하게 내려오면
            // 로컬 정상 데이터가 \"사라진 것처럼\" 보일 수 있습니다.
            //
            // 정책:
            // - id 기준으로 병합하되,
            // - 같은 id 충돌 시 \"더 완전한 데이터\"를 우선하고,
            // - 서로 다른 슬롯(roomId/date/period)인데 id가 같다면 새 id를 부여해 데이터 유실을 막습니다.

            const localRooms = Storage.getRooms();
            const localRes = Storage.getReservations();

            const remoteRooms = Array.isArray(rooms) ? rooms : [];
            const remoteRes = Array.isArray(reservations) ? reservations : [];

            // 고정방 이름 기반으로 "원격 roomId -> canonical roomId" 매핑 생성
            // (원격에 같은 이름의 방이 다른 id로 존재하면 예약이 다른 방으로 보이거나 중복/유실이 발생할 수 있음)
            const fixedIdMap = {};
            if (Storage?.FIXED_ROOMS?.length) {
                const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
                for (const f of Storage.FIXED_ROOMS) {
                    fixedIdMap[f.id] = f.id;
                    const nn = norm(f.name);
                    for (const rr of remoteRooms) {
                        if (!rr) continue;
                        if (norm(rr.name) === nn) {
                            const rid = String(rr.id || '').trim();
                            if (rid) fixedIdMap[rid] = f.id;
                        }
                    }
                    for (const lr of localRooms) {
                        if (!lr) continue;
                        if (norm(lr.name) === nn) {
                            const rid = String(lr.id || '').trim();
                            if (rid) fixedIdMap[rid] = f.id;
                        }
                    }
                }
            }

            const roomMap = new Map();
            for (const r of localRooms) {
                if (!r) continue;
                const id = String(r.id || '').trim();
                if (!id) continue;
                roomMap.set(id, r);
            }
            for (const r of remoteRooms) {
                if (!r) continue;
                const id = String(r.id || '').trim();
                if (!id) continue;
                // 방은 필드가 단순해서 원격 우선으로 덮어도 위험이 낮습니다.
                roomMap.set(id, r);
            }

            const normalizeResForMerge = (x) => {
                if (!x) return null;
                const out = { ...x };
                if (!out.roomId && out.roomID) out.roomId = out.roomID; // 호환
                if (!out.createdAt && out.createAt) out.createdAt = out.createAt; // 호환

                out.id = String(out.id || '').trim();
                out.roomId = String(out.roomId || '').trim();
                // 고정방 roomId는 canonical로 통합(merge 이전에 적용해야 중복 생성이 안 됨)
                if (fixedIdMap[out.roomId]) out.roomId = fixedIdMap[out.roomId];
                out.date = Storage?._normalizeDateISO ? Storage._normalizeDateISO(out.date) : String(out.date || '').trim();
                const p = Number(out.period);
                out.period = Number.isFinite(p) ? p : out.period;
                return out;
            };

            const quality = (r) => {
                if (!r) return 0;
                let q = 0;
                if (r.roomId) q++;
                if (r.date) q++;
                if (Number.isFinite(Number(r.period))) q++;
                if (r.name != null && String(r.name).trim()) q++;
                return q;
            };

            const getTs = (r) => {
                if (!r) return '';
                // 다양한 표기 흔들림에 대응 (서버/시트 헤더에 따라 키가 달라질 수 있음)
                const v =
                    r.updatedAt ?? r.updatedat ??
                    r.createdAt ?? r.createdat ??
                    r.createAt ?? r.createat ?? '';
                const s = String(v || '').trim();
                // ISO datetime은 앞 19자 정도면 비교 가능하지만, 여기선 문자열 비교(서버도 동일 방식)로 충분
                return s;
            };

            const sameSlot = (a, b) => {
                if (!a || !b) return false;
                return (
                    String(a.roomId || '').trim() === String(b.roomId || '').trim() &&
                    String(a.date || '').trim() === String(b.date || '').trim() &&
                    Number(a.period) === Number(b.period)
                );
            };

            const resMap = new Map();
            const addRes = (raw, prefer = 'local') => {
                const r = normalizeResForMerge(raw);
                if (!r) return;

                let id = r.id || '';
                if (!id) id = generateId('reservation');

                const existing = resMap.get(id);
                if (!existing) {
                    r.id = id;
                    resMap.set(id, r);
                    return;
                }

                // 같은 슬롯이면 품질/타임스탬프로 더 나은 쪽 선택
                if (sameSlot(existing, r)) {
                    const qe = quality(existing);
                    const qr = quality(r);
                    const te = getTs(existing);
                    const tr = getTs(r);

                    // 원격이 더 완전하거나 최신이면 교체, 아니면 유지
                    if (qr > qe || (qr === qe && tr && (!te || tr >= te))) {
                        r.id = id;
                        resMap.set(id, r);
                    } else if (prefer === 'remote' && qr === qe && !tr && !te) {
                        // 타임스탬프가 둘 다 없으면, 동률일 때만 remote 우선 옵션
                        r.id = id;
                        resMap.set(id, r);
                    }
                    return;
                }

                // 서로 다른 슬롯인데 id가 같으면 -> 데이터 유실 방지를 위해 새 id 부여
                let newId = id;
                while (resMap.has(newId)) {
                    newId = generateId('reservation');
                }
                r.id = newId;
                resMap.set(newId, r);
            };

            // 로컬 먼저 반영 후, 원격을 \"안전하게\" 덧씌움
            for (const r of localRes) addRes(r, 'local');
            for (const r of remoteRes) addRes(r, 'remote');

            Storage.saveRooms(Array.from(roomMap.values()));
            Storage.saveReservations(Array.from(resMap.values()));
            // 최종적으로 고정방 강제 + 이름 중복 방 정리 + 예약 roomId 마이그레이션
            Storage.ensureFixedRooms?.();
            loadRooms();
            loadReservations();
            Storage.ensureUniqueRoomIds();
            Storage.ensureUniqueReservationIds();
            loadRooms();

            // 현재 선택 유지(없으면 첫 방)
            if (AppState.currentRoomId && AppState.rooms.some(r => r.id === AppState.currentRoomId)) {
                renderRoomTabs();
                renderSchedule();
            } else if (AppState.rooms.length > 0) {
                selectRoom(AppState.rooms[0].id);
            } else {
                AppState.currentRoomId = null;
                renderRoomTabs();
                renderSchedule();
            }
        });
        GoogleSheets.startAutoSync?.();
    }
}

/**
 * 기본 특별실 생성
 */
function createDefaultRooms() {
    // 요청: 고정 특별실을 기본으로 생성/보장
    Storage.ensureFixedRooms?.();
    loadRooms();
    renderRoomTabs();
    if (AppState.rooms.length > 0) selectRoom(AppState.rooms[0].id);
}

/**
 * 특별실 목록 로드
 */
function loadRooms() {
    AppState.rooms = Storage.getRooms();
}

/**
 * 예약 목록 로드
 */
function loadReservations() {
    AppState.reservations = Storage.getReservations();
}

/**
 * 이벤트 리스너 설정
 */
function setupEventListeners() {
    // 날짜 네비게이션
    elements.prevWeekBtn.addEventListener('click', () => navigateWeek(-1));
    elements.nextWeekBtn.addEventListener('click', () => navigateWeek(1));
    elements.weekSelector.addEventListener('change', (e) => {
        const selectedDate = new Date(e.target.value);
        if (!isNaN(selectedDate.getTime())) {
            AppState.currentWeek = selectedDate;
            renderSchedule();
        }
    });

    // 오늘이 포함된 주로 이동
    if (elements.goTodayBtn) {
        elements.goTodayBtn.addEventListener('click', () => {
            AppState.currentWeek = new Date();
            updateWeekSelector();
            renderSchedule();
        });
    }
    
    // 특별실 추가
    elements.addRoomBtn.addEventListener('click', () => {
        showAddRoomModal();
    });
    
    // 내예약보기
    elements.viewMyReservationsBtn.addEventListener('click', showMyReservations);
    
    // 구글 스프레드시트 설정
    if (elements.googleSheetsConfigBtn) {
        // 배포자가 서버 URL을 고정한 경우, 설정 버튼을 숨겨 "설정 없이 바로 사용" 느낌으로 만듭니다.
        if (typeof window !== 'undefined' && window.APP_LOCK_SERVER_URL === true) {
            elements.googleSheetsConfigBtn.classList.add('hidden');
        } else {
            elements.googleSheetsConfigBtn.addEventListener('click', () => {
                GoogleSheets.showConfigModal();
            });
        }
    }
    
    // 구글 스프레드시트 동기화
    elements.syncToSheetsBtn.addEventListener('click', () => {
        GoogleSheets.syncToSheets();
    });

    // 구글 스프레드시트에서 불러오기
    if (elements.syncFromSheetsBtn) {
        elements.syncFromSheetsBtn.addEventListener('click', () => {
            GoogleSheets.syncFromSheets();
        });
    }
    
    // 모달 이벤트
    elements.cancelModalBtn.addEventListener('click', hideReservationModal);
    elements.cancelRoomModalBtn.addEventListener('click', hideAddRoomModal);
    elements.cancelEditRoomModalBtn.addEventListener('click', hideEditRoomModal);
    elements.reservationForm.addEventListener('submit', handleReservationSubmit);
    elements.addRoomForm.addEventListener('submit', handleAddRoomSubmit);
    elements.editRoomForm.addEventListener('submit', handleEditRoomSubmit);
    elements.deleteReservationBtn.addEventListener('click', handleDeleteReservation);
    
    // 모달 외부 클릭 시 닫기
    elements.reservationModal.addEventListener('click', (e) => {
        if (e.target === elements.reservationModal) {
            hideReservationModal();
        }
    });
    
    elements.addRoomModal.addEventListener('click', (e) => {
        if (e.target === elements.addRoomModal) {
            hideAddRoomModal();
        }
    });
    
    elements.editRoomModal.addEventListener('click', (e) => {
        if (e.target === elements.editRoomModal) {
            hideEditRoomModal();
        }
    });
}



/**
 * 특별실 삭제 요청 (비밀번호 확인)
 */
function requestDeleteRoom(room) {
    if (Storage?.isFixedRoomId?.(room?.id)) {
        alert('이 특별실은 고정 특별실이라 삭제할 수 없습니다.');
        return;
    }
    const password = prompt(`${room.name}을(를) 삭제하려면 비밀번호(4자리)를 입력하세요:`);
    if (password === COMMON_PASSWORD) {
        if (confirm(`${room.name}을(를) 삭제하시겠습니까? 모든 예약도 함께 삭제됩니다.`)) {
            deleteRoom(room.id);
        }
    } else if (password !== null) {
        alert('비밀번호가 올바르지 않습니다.');
    }
}

/**
 * 특별실 삭제
 */
function deleteRoom(roomId) {
    Storage.deleteRoom(roomId);
    loadRooms();
    loadReservations();
    renderSchedule();
}

/**
 * 특별실 탭 렌더링
 */
function renderRoomTabs() {
    if (!elements.roomTabs) return;
    
    elements.roomTabs.innerHTML = '';
    
    AppState.rooms.forEach(room => {
        const tab = document.createElement('button');
        tab.className = `room-tab ${room.id === AppState.currentRoomId ? 'active' : ''}`;
        tab.textContent = room.name;
        tab.draggable = true;
        tab.dataset.roomId = room.id;
        
        // 클릭 시 특별실 선택
        tab.addEventListener('click', (e) => {
            e.stopPropagation();
            selectRoom(room.id);
        });
        
        // 드래그 시작
        tab.addEventListener('dragstart', (e) => {
            AppState.draggedRoom = room;
            e.dataTransfer.effectAllowed = 'move';
            tab.style.opacity = '0.5';
        });
        
        // 드래그 종료
        tab.addEventListener('dragend', (e) => {
            tab.style.opacity = '1';
            AppState.draggedRoom = null;
        });
        
        // 우클릭 시 수정/삭제 메뉴
        tab.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showRoomContextMenu(e, room);
        });
        
        elements.roomTabs.appendChild(tab);
    });
}

/**
 * 특별실 컨텍스트 메뉴 표시
 */
function showRoomContextMenu(e, room) {
    const menu = document.createElement('div');
    menu.className = 'fixed bg-white border rounded shadow-lg z-50';
    menu.style.left = e.pageX + 'px';
    menu.style.top = e.pageY + 'px';

    const isFixed = Storage?.isFixedRoomId?.(room?.id);
    menu.innerHTML = `
        <button class="block w-full text-left px-4 py-2 ${isFixed ? 'text-gray-400 cursor-not-allowed' : 'hover:bg-gray-100'} edit-room-menu" data-room-id="${room.id}">
            이름 수정${isFixed ? ' (고정)' : ''}
        </button>
        <button class="block w-full text-left px-4 py-2 ${isFixed ? 'text-gray-400 cursor-not-allowed' : 'hover:bg-gray-100 text-red-600'} delete-room-menu" data-room-id="${room.id}">
            삭제${isFixed ? ' (고정)' : ''}
        </button>
    `;
    
    document.body.appendChild(menu);
    
    menu.querySelector('.edit-room-menu').addEventListener('click', () => {
        if (isFixed) {
            alert('이 특별실은 고정 특별실이라 이름을 수정할 수 없습니다.');
        } else {
            showEditRoomModal(room);
        }
        document.body.removeChild(menu);
    });
    
    menu.querySelector('.delete-room-menu').addEventListener('click', () => {
        if (isFixed) {
            alert('이 특별실은 고정 특별실이라 삭제할 수 없습니다.');
        } else {
            requestDeleteRoom(room);
        }
        document.body.removeChild(menu);
    });
    
    // 메뉴 외부 클릭 시 닫기
    setTimeout(() => {
        const closeMenu = (e) => {
            if (!menu.contains(e.target)) {
                document.body.removeChild(menu);
                document.removeEventListener('click', closeMenu);
            }
        };
        document.addEventListener('click', closeMenu);
    }, 100);
}

/**
 * 특별실 선택
 */
function selectRoom(roomId) {
    AppState.currentRoomId = roomId;
    const room = AppState.rooms.find(r => r.id === roomId);
    if (elements.scheduleTitle) {
        elements.scheduleTitle.textContent = room ? `${room.name} 시간표` : '특별실을 선택하세요';
    }
    applyRoomTheme(roomId);
    renderRoomTabs();
    renderSchedule();
}

/**
 * 특별실 삭제
 */
function deleteRoom(roomId) {
    if (Storage?.isFixedRoomId?.(roomId)) {
        alert('이 특별실은 고정 특별실이라 삭제할 수 없습니다.');
        return;
    }
    Storage.deleteRoom(roomId);
    loadRooms();
    loadReservations();
    
    if (AppState.currentRoomId === roomId) {
        AppState.currentRoomId = null;
        if (AppState.rooms.length > 0) {
            selectRoom(AppState.rooms[0].id);
        } else {
            renderSchedule();
        }
    } else {
        renderRoomTabs();
    }

    // 서버 반영(자동)
    if (typeof GoogleSheets !== 'undefined') {
        GoogleSheets.queueSave?.({ type: 'deleteRoom', id: roomId });
    }
}

/**
 * 주 단위 네비게이션
 */
function navigateWeek(direction) {
    AppState.currentWeek = addWeeks(AppState.currentWeek, direction);
    updateWeekSelector();
    renderSchedule();
}

/**
 * 주 선택 드롭다운 업데이트
 */
function updateWeekSelector() {
    elements.weekSelector.innerHTML = '';
    
    // 현재 주 기준으로 앞뒤 4주씩 생성
    for (let i = -4; i <= 4; i++) {
        const weekDate = addWeeks(AppState.currentWeek, i);
        const option = document.createElement('option');
        option.value = weekDate.toISOString().split('T')[0];
        option.textContent = formatWeekRange(weekDate);
        
        // 현재 주 선택
        if (i === 0) {
            option.selected = true;
        }
        
        elements.weekSelector.appendChild(option);
    }
}

/**
 * 시간표 렌더링
 */
function renderSchedule() {
    if (!AppState.currentRoomId) {
        if (elements.scheduleTitle) {
            elements.scheduleTitle.textContent = '특별실을 선택하세요';
        }
        elements.scheduleBody.innerHTML = '<tr><td colspan="6" class="text-center p-8 text-gray-500">특별실을 선택해주세요</td></tr>';
        return;
    }
    
    const weekDays = getWeekDays(AppState.currentWeek);
    
    // 요일 헤더 업데이트
    const dayNames = ['월', '화', '수', '목', '금'];
    const headers = [elements.monday, elements.tuesday, elements.wednesday, elements.thursday, elements.friday];
    
    weekDays.forEach((day, index) => {
        headers[index].textContent = `${dayNames[index]} (${formatDate(day)})`;
    });
    
    // 시간표 본문 생성
    elements.scheduleBody.innerHTML = '';
    
    for (let period = 1; period <= 10; period++) {
        const row = document.createElement('tr');
        
        // 교시 번호 셀
        const periodCell = document.createElement('td');
        periodCell.className = 'border p-2 text-center bg-gray-50 period-number';
        periodCell.textContent = period;
        row.appendChild(periodCell);
        
        // 각 요일별 셀 생성
        weekDays.forEach(day => {
            const cell = document.createElement('td');
            cell.className = 'border p-2 schedule-cell';
            
            const dateStr = formatDateISO(day);
            const reservation = Storage.getReservation(AppState.currentRoomId, dateStr, period);
            
            // 드래그앤드롭 이벤트
            cell.addEventListener('dragover', (e) => {
                e.preventDefault();
                if (AppState.draggedRoom) {
                    cell.classList.add('drag-over');
                }
            });
            
            cell.addEventListener('dragleave', () => {
                cell.classList.remove('drag-over');
            });
            
            cell.addEventListener('drop', (e) => {
                e.preventDefault();
                cell.classList.remove('drag-over');
                
                if (AppState.draggedRoom) {
                    // 드롭한 위치의 시간으로 예약 모달 열기
                    showReservationModal(null, dateStr, period, AppState.draggedRoom.id);
                    AppState.draggedRoom = null;
                }
            });
            
            if (reservation) {
                // 예약이 있는 경우
                cell.classList.add('reserved', 'status-default');
                cell.innerHTML = `
                    <div class="reservation-content">
                        <div class="flex items-center gap-1">
                            <span class="text-yellow-500 text-lg">★</span>
                            <div class="reservation-name">${escapeHtml(reservation.name)}</div>
                        </div>
                        ${reservation.class ? `<div class="reservation-class">${escapeHtml(reservation.class)}</div>` : ''}
                    </div>
                `;
                cell.addEventListener('click', () => {
                    // 수정/삭제는 공통 비밀번호 필요
                    if (!requireCommonPassword('예약을 수정/삭제')) return;
                    authorizedReservationId = reservation.id;
                    showReservationModal(reservation);
                });
            } else {
                // 빈 칸인 경우
                authorizedReservationId = null;
                cell.addEventListener('click', () => showReservationModal(null, dateStr, period, AppState.currentRoomId));
            }
            
            row.appendChild(cell);
        });
        
        elements.scheduleBody.appendChild(row);
    }
}

/**
 * 예약 모달 표시
 */
function showReservationModal(reservation, date = null, period = null, roomId = null) {
    if (reservation) {
        // 수정 모드
        elements.modalTitle.textContent = '예약 수정';
        elements.reservationId.value = reservation.id;
        elements.reservationDate.value = reservation.date;
        elements.reservationPeriod.value = reservation.period;
        elements.reservationRoomId.value = reservation.roomId;
        elements.reservationName.value = reservation.name || '';
        elements.reservationClass.value = reservation.class || '';
        elements.reservationPurpose.value = reservation.purpose || '';
        elements.deleteReservationBtn.classList.remove('hidden');
    } else {
        // 생성 모드
        elements.modalTitle.textContent = '예약하기';
        authorizedReservationId = null;
        elements.reservationId.value = '';
        elements.reservationDate.value = date;
        elements.reservationPeriod.value = period;
        elements.reservationRoomId.value = roomId;
        elements.reservationName.value = '';
        elements.reservationClass.value = '';
        elements.reservationPurpose.value = '';
        elements.deleteReservationBtn.classList.add('hidden');
    }
    
    elements.reservationModal.classList.add('show');
}

/**
 * 예약 모달 숨기기
 */
function hideReservationModal() {
    elements.reservationModal.classList.remove('show');
    elements.reservationForm.reset();
    authorizedReservationId = null;
}

/**
 * 예약 제출 처리
 */
function handleReservationSubmit(e) {
    e.preventDefault();
    
    const reservationId = elements.reservationId.value;
    const reservationData = {
        roomId: elements.reservationRoomId.value,
        date: elements.reservationDate.value,
        period: parseInt(elements.reservationPeriod.value),
        name: elements.reservationName.value.trim(),
        class: elements.reservationClass.value.trim(),
        purpose: elements.reservationPurpose.value.trim(),
        status: 'default'
    };
    
    if (reservationId) {
        // 수정은 공통 비밀번호 확인 필요 (우회 방지)
        if (authorizedReservationId !== reservationId) {
            if (!requireCommonPassword('예약을 수정')) return;
            authorizedReservationId = reservationId;
        }
        // 수정
        const updated = Storage.updateReservation(reservationId, reservationData);
        // 서버 반영(자동)
        if (typeof GoogleSheets !== 'undefined' && updated) {
            GoogleSheets.queueSave?.({ type: 'upsertReservation', id: updated.id, data: updated });
        }
    } else {
        // 생성
        const created = Storage.addReservation(reservationData);
        // 서버 반영(자동)
        if (typeof GoogleSheets !== 'undefined' && created) {
            GoogleSheets.queueSave?.({ type: 'upsertReservation', id: created.id, data: created });
        }
    }
    
    loadReservations();
    renderSchedule();
    hideReservationModal();
}

/**
 * 예약 삭제 처리
 */
function handleDeleteReservation() {
    const reservationId = elements.reservationId.value;
    if (!reservationId) return;
    // 삭제는 공통 비밀번호 확인 필요 (우회 방지)
    if (authorizedReservationId !== reservationId) {
        if (!requireCommonPassword('예약을 삭제')) return;
        authorizedReservationId = reservationId;
    }
    if (confirm('예약을 삭제하시겠습니까?')) {
        Storage.deleteReservation(reservationId);
        // 서버 반영(자동)
        if (typeof GoogleSheets !== 'undefined') {
            GoogleSheets.queueSave?.({ type: 'deleteReservation', id: reservationId });
        }
        loadReservations();
        renderSchedule();
        hideReservationModal();
    }
}

/**
 * 특별실 추가 모달 표시
 */
function showAddRoomModal() {
    elements.roomName.value = '';
    elements.addRoomModal.classList.add('show');
}

/**
 * 특별실 추가 모달 숨기기
 */
function hideAddRoomModal() {
    elements.addRoomModal.classList.remove('show');
    elements.addRoomForm.reset();
}

/**
 * 특별실 추가 제출 처리
 */
function handleAddRoomSubmit(e) {
    e.preventDefault();
    
    const roomName = elements.roomName.value.trim();
    if (roomName) {
        const newRoom = Storage.addRoom(roomName);
        loadRooms();
        renderRoomTabs();
        selectRoom(newRoom.id);
        hideAddRoomModal();

        // 서버 반영(자동)
        if (typeof GoogleSheets !== 'undefined' && newRoom) {
            GoogleSheets.queueSave?.({ type: 'upsertRoom', id: newRoom.id, data: newRoom });
        }
    }
}

/**
 * 특별실 수정 모달 표시
 */
function showEditRoomModal(room) {
    if (Storage?.isFixedRoomId?.(room?.id)) {
        alert('이 특별실은 고정 특별실이라 이름을 수정할 수 없습니다.');
        return;
    }
    elements.editRoomId.value = room.id;
    elements.editRoomName.value = room.name;
    elements.editRoomModal.classList.add('show');
}

/**
 * 특별실 수정 모달 숨기기
 */
function hideEditRoomModal() {
    elements.editRoomModal.classList.remove('show');
    elements.editRoomForm.reset();
}

/**
 * 특별실 수정 제출 처리
 */
function handleEditRoomSubmit(e) {
    e.preventDefault();
    
    const roomId = elements.editRoomId.value;
    const newName = elements.editRoomName.value.trim();
    
    if (roomId && newName) {
        const updated = Storage.updateRoom(roomId, newName);
        loadRooms(); // AppState.rooms 업데이트
        renderRoomTabs();
        renderSchedule(); // 시간표 다시 렌더링
        hideEditRoomModal();

        // 서버 반영(자동)
        if (typeof GoogleSheets !== 'undefined' && updated) {
            GoogleSheets.queueSave?.({ type: 'upsertRoom', id: updated.id, data: updated });
        }
    }
}

/**
 * 내예약보기 모달 표시
 */
function showMyReservations() {
    const reservations = Storage.getReservations();
    const rooms = Storage.getRooms();
    
    // 예약자명 입력 받기
    const userName = prompt('예약자명을 입력하세요:');
    if (!userName || !userName.trim()) {
        return;
    }
    
    // 해당 사용자의 예약 필터링
    const myReservations = reservations.filter(res => 
        res.name && res.name.trim().toLowerCase() === userName.trim().toLowerCase()
    );
    
    if (myReservations.length === 0) {
        alert(`${userName}님의 예약이 없습니다.`);
        return;
    }
    
    // 모달 생성
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
    modal.innerHTML = `
        <div class="bg-white rounded-lg p-6 w-full max-w-2xl mx-4 max-h-[80vh] overflow-y-auto">
            <h2 class="text-xl font-bold mb-4">${userName}님의 예약 목록</h2>
            <div class="space-y-2">
                ${myReservations.map(res => {
                    const room = rooms.find(r => r.id === res.roomId);
                    const date = parseDateISO(res.date);
                    
                    return `
                        <div class="border rounded p-3 hover:bg-gray-50">
                            <div class="flex justify-between items-start">
                                <div>
                                    <div class="font-semibold">${room ? room.name : '알 수 없음'}</div>
                                    <div class="text-sm text-gray-600">
                                        ${formatDate(date)} ${res.period}교시
                                        ${res.class ? ` | ${res.class}` : ''}
                                    </div>
                                    ${res.purpose ? `<div class="text-sm text-gray-500 mt-1">${escapeHtml(res.purpose)}</div>` : ''}
                                </div>
                                <div class="flex items-center gap-2">
                                    <button class="px-2 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600" 
                                            data-reservation-id="${res.id}">
                                        보기
                                    </button>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
            <div class="mt-4 flex justify-end">
                <button id="closeMyReservationsBtn" class="px-4 py-2 bg-gray-300 rounded hover:bg-gray-400">
                    닫기
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // 닫기 버튼
    modal.querySelector('#closeMyReservationsBtn').addEventListener('click', () => {
        document.body.removeChild(modal);
    });
    
    // 보기 버튼들
    modal.querySelectorAll('[data-reservation-id]').forEach(btn => {
        btn.addEventListener('click', () => {
            const reservationId = btn.getAttribute('data-reservation-id');
            const reservation = reservations.find(r => r.id === reservationId);
            if (reservation) {
                // 해당 특별실 선택
                if (reservation.roomId !== AppState.currentRoomId) {
                    selectRoom(reservation.roomId);
                }
                // 해당 주로 이동
                const resDate = parseDateISO(reservation.date);
                AppState.currentWeek = resDate;
                updateWeekSelector();
                renderSchedule();
                // 예약 모달 표시
                setTimeout(() => {
                    showReservationModal(reservation);
                }, 100);
                document.body.removeChild(modal);
            }
        });
    });
    
    // 모달 외부 클릭 시 닫기
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    });
}

/**
 * HTML 이스케이프 유틸리티
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 애플리케이션 시작
document.addEventListener('DOMContentLoaded', init);
