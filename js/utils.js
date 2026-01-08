/**
 * 날짜 및 시간 관련 유틸리티 함수
 */

/**
 * 주의 시작일(월요일)을 계산합니다.
 * @param {Date} date - 기준 날짜
 * @returns {Date} 해당 주의 월요일 날짜
 */
function getWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay(); // 0(일요일) ~ 6(토요일)
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // 월요일로 조정
    return new Date(d.setDate(diff));
}

/**
 * 주의 종료일(일요일)을 계산합니다.
 * @param {Date} date - 기준 날짜
 * @returns {Date} 해당 주의 일요일 날짜
 */
function getWeekEnd(date) {
    const start = getWeekStart(date);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return end;
}

/**
 * 주 단위로 날짜를 이동합니다.
 * @param {Date} date - 기준 날짜
 * @param {number} weeks - 이동할 주 수 (양수: 다음 주, 음수: 이전 주)
 * @returns {Date} 이동된 날짜
 */
function addWeeks(date, weeks) {
    const result = new Date(date);
    result.setDate(result.getDate() + (weeks * 7));
    return result;
}

/**
 * 날짜를 YYYY.M.D 형식으로 포맷팅합니다.
 * @param {Date} date - 포맷팅할 날짜
 * @returns {string} 포맷팅된 날짜 문자열
 */
function formatDate(date) {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${year}.${month}.${day}`;
}

/**
 * 날짜를 YYYY-MM-DD 형식으로 포맷팅합니다.
 * @param {Date} date - 포맷팅할 날짜
 * @returns {string} 포맷팅된 날짜 문자열
 */
function formatDateISO(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * YYYY-MM-DD 문자열을 Date 객체로 변환합니다.
 * @param {string} dateString - 날짜 문자열
 * @returns {Date} Date 객체
 */
function parseDateISO(dateString) {
    return new Date(dateString + 'T00:00:00');
}

/**
 * 주의 월~금 날짜 배열을 반환합니다.
 * @param {Date} date - 기준 날짜
 * @returns {Date[]} 월요일부터 금요일까지의 날짜 배열
 */
function getWeekDays(date) {
    const start = getWeekStart(date);
    const days = [];
    for (let i = 0; i < 5; i++) {
        const day = new Date(start);
        day.setDate(start.getDate() + i);
        days.push(day);
    }
    return days;
}

/**
 * 주 범위를 문자열로 포맷팅합니다.
 * 예: "2026년 3.16~3.22"
 * @param {Date} date - 기준 날짜
 * @returns {string} 포맷팅된 주 범위 문자열
 */
function formatWeekRange(date) {
    const start = getWeekStart(date);
    const end = getWeekEnd(date);
    const year = start.getFullYear();
    const startMonth = start.getMonth() + 1;
    const startDay = start.getDate();
    const endMonth = end.getMonth() + 1;
    const endDay = end.getDate();
    
    return `${year}년 ${startMonth}.${startDay}~${endMonth}.${endDay}`;
}

/**
 * 주 범위를 드롭다운 옵션용 문자열로 포맷팅합니다.
 * @param {Date} date - 기준 날짜
 * @returns {string} 포맷팅된 문자열
 */
function formatWeekRangeForSelect(date) {
    const start = getWeekStart(date);
    const end = getWeekEnd(date);
    return formatWeekRange(date);
}

