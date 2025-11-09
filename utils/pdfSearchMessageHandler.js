/**
 * PDF 뷰어 검색 이벤트 메시지 핸들러
 * 엔터 키 또는 검색 버튼 클릭 시 사용자가 입력한 검색어를 메시지창으로 표시
 */

class PdfSearchMessageHandler {
  constructor() {
    this.isInitialized = false;
    this.init();
  }

  /**
   * 초기화 - PDF 뷰어가 로드될 때까지 대기 후 이벤트 리스너 등록
   */
  init() {
    // DOM이 로드될 때까지 대기
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.setupEventListeners());
    } else {
      this.setupEventListeners();
    }
  }

  /**
   * 이벤트 리스너 설정
   */
  setupEventListeners() {
    // PDF 뷰어의 요소들이 로드될 때까지 대기
    const checkInterval = setInterval(() => {
      const searchInput = document.getElementById('search-input');
      const searchButton = document.getElementById('search-button');

      if (searchInput && searchButton && !this.isInitialized) {
        clearInterval(checkInterval);
        this.attachEventListeners(searchInput, searchButton);
        this.isInitialized = true;
        console.log('✅ PDF 검색 메시지 핸들러 초기화 완료');
      }
    }, 100);

    // 10초 후에도 초기화되지 않으면 중단
    setTimeout(() => {
      clearInterval(checkInterval);
      if (!this.isInitialized) {
        console.warn('⚠️ PDF 검색 메시지 핸들러 초기화 실패: 검색 요소를 찾을 수 없습니다.');
      }
    }, 10000);
  }

  /**
   * 검색 입력 필드와 버튼에 이벤트 리스너 추가
   */
  attachEventListeners(searchInput, searchButton) {
    // Enter 키 이벤트 리스너 추가
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const searchText = searchInput.value.trim();
        if (searchText) {
          // 기존 이벤트 전파 차단
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          
          // 새로운 로직 실행
          this.showSearchMessage(searchText, 'Enter 키');
        }
      }
    }, true); // capture phase에서 실행하여 기존 이벤트보다 먼저 실행

    // 검색 버튼 클릭 이벤트 리스너 추가
    searchButton.addEventListener('click', (e) => {
      const searchText = searchInput.value.trim();
      if (searchText) {
        // 기존 이벤트 전파 차단
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        
        // 새로운 로직 실행
        this.showSearchMessage(searchText, '검색 버튼');
      }
    }, true); // capture phase에서 실행하여 기존 이벤트보다 먼저 실행
  }

  /**
   * 검색어를 메시지창으로 표시
   */
  showSearchMessage(searchText, triggerType) {
    const message = `검색어: "${searchText}"\n트리거: ${triggerType}`;
    
    // 간단한 alert로 표시
    alert(message);
    
    // 콘솔에도 로그 출력
    console.log(`🔍 검색 이벤트 감지 [${triggerType}]:`, searchText);
  }
}

// 자동 초기화
if (typeof window !== 'undefined') {
  // 페이지가 로드될 때 자동으로 초기화
  const handler = new PdfSearchMessageHandler();
  
  // 전역에서 접근 가능하도록 설정 (필요한 경우)
  window.pdfSearchMessageHandler = handler;
}

