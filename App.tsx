import React, { useState, useEffect, useCallback } from 'react';
import ChatWindow from './components/ChatWindow';
import SourceInfo from './components/SourceInfo';
import CompressionStats from './components/CompressionStats';
import ConfirmDialog from './components/ConfirmDialog';
import { FirestoreCacheManager } from './components/FirestoreCacheManager';
import { AdvancedSearchTest } from './components/AdvancedSearchTest';
import { SourceViewer } from './components/SourceViewer';
import { TooltipProvider } from './components/TooltipContext';
import { geminiService } from './services/geminiService';
import { FirestoreService } from './services/firestoreService';
import { SourceInfo as SourceInfoType } from './types';

function App() {
  const [sources, setSources] = useState<SourceInfoType[]>([]);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [showCompressionStats, setShowCompressionStats] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showAdvancedSearchTest, setShowAdvancedSearchTest] = useState(false);
  const [messages, setMessages] = useState<any[]>([]);
  const [chatKey, setChatKey] = useState(0); // ChatWindow 리렌더링을 위한 키
  
  // ✅ SourceViewer 상태 관리
  const [selectedDocumentId, setSelectedDocumentId] = useState<string>();
  const [highlightedChunkId, setHighlightedChunkId] = useState<string>();
  const [questionContent, setQuestionContent] = useState<string>(''); // ✅ 질문 내용 저장
  
  // ✅ PDF 뷰어 상태 관리
  const [pdfViewerMode, setPdfViewerMode] = useState<'text' | 'pdf'>('text');
  const [pdfCurrentPage, setPdfCurrentPage] = useState<number>(1);
  const [pdfFilename, setPdfFilename] = useState<string>('');
  
  // ✅ 사이드바 리사이징 관련 상태
  const [sidebarWidth, setSidebarWidth] = useState<number>(450); // 기본값: 450px (약 25-30%)
  const [isResizing, setIsResizing] = useState(false);
  const [originalSidebarWidth, setOriginalSidebarWidth] = useState<number>(450); // 원래 사이드바 너비 저장
  
  // ✅ 리사이즈 핸들러들
  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  useEffect(() => {
    // 리사이즈 업데이트 rAF 스로틀링
    let rafId: number | null = null;
    let pendingWidth: number | null = null;

    const flushWidth = () => {
      if (pendingWidth !== null) {
        setSidebarWidth(pendingWidth);
        pendingWidth = null;
      }
      rafId = null;
    };

    const handleResize = (e: MouseEvent) => {
      if (!isResizing) return;
      // 최소 너비: 250px, 최대 너비: 800px (더 작게 조정 가능하게)
      const newWidth = Math.min(Math.max(250, e.clientX), 800);
      pendingWidth = newWidth;
      if (rafId === null) {
        rafId = requestAnimationFrame(flushWidth);
      }
    };

    const handleResizeEnd = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleResize);
      document.addEventListener('mouseup', handleResizeEnd);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleResize);
      document.removeEventListener('mouseup', handleResizeEnd);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [isResizing]);

  // ✅ 소스뷰어 표시/숨김 시 사이드바 너비 자동 조정
  useEffect(() => {
    if (selectedDocumentId) {
      // 소스뷰어가 표시될 때: 현재 너비를 원래 너비로 저장하고 2배로 확장
      const currentWidth = sidebarWidth;
      setOriginalSidebarWidth(currentWidth);
      const expandedWidth = Math.min(currentWidth * 1.5, 800); // 최대 800px, 1.5배로 확장
      setSidebarWidth(expandedWidth);
    } else if (selectedDocumentId === undefined) {
      // 소스뷰어가 닫힐 때: 원래 너비로 복원
      setSidebarWidth(originalSidebarWidth);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDocumentId]);
  
  // ✅ 소스 클릭 핸들러
  const handleSourceClick = async (sourceId: string) => {
    console.log('🖱️ 소스 클릭됨, sourceId:', sourceId);
    
    // sourceId가 숫자만 있는 경우 (인덱스일 가능성)
    if (/^\d+$/.test(sourceId)) {
      console.warn('⚠️ sourceId가 숫자입니다. 이는 배열 인덱스일 수 있습니다.');
      console.log('📋 sources 배열:', sources);
      
      // 인덱스로 변환
      const index = parseInt(sourceId);
      if (sources && sources[index]) {
        const actualSourceId = sources[index].id;
        console.log('✅ 인덱스를 실제 sourceId로 변환:', actualSourceId);
        await handleSourceClick(actualSourceId);
        return;
      } else {
        console.error('❌ 유효하지 않은 인덱스:', index, 'sources 길이:', sources.length);
        return;
      }
    }
    
    try {
      // FirestoreService 인스턴스 가져오기
      const firestoreService = FirestoreService.getInstance();
      
      // Firestore에서 모든 문서 가져오기
      const allDocuments = await firestoreService.getAllDocuments();
      console.log('📚 전체 문서 목록:', allDocuments.map(d => ({ id: d.id, title: d.title, filename: d.filename })));
      
      // sourceId에서 파일명 추출 (예: "filename-page-section" 또는 "filename-section")
      const parts = sourceId.split('-');
      console.log('🔍 sourceId 파싱:', parts);
      
      // 가능한 모든 조합 시도
      let matchingDoc = null;
      
      // 방법 1: sourceId가 Firestore document ID와 일치하는 경우
      matchingDoc = allDocuments.find(doc => doc.id === sourceId);
      
      if (!matchingDoc) {
        // 방법 2: filename에 .pdf 추가
        matchingDoc = allDocuments.find(doc => 
          doc.filename === parts[0] + '.pdf' || 
          doc.filename === parts[0] ||
          doc.filename.startsWith(parts[0])
        );
      }
      
      if (!matchingDoc && parts.length > 1) {
        // 방법 3: 파일명에 하이픈이 포함된 경우
        const firstTwo = parts[0] + '-' + parts[1];
        matchingDoc = allDocuments.find(doc => 
          doc.filename.includes(firstTwo) || 
          doc.filename.startsWith(parts[0])
        );
      }
      
      if (matchingDoc) {
        setSelectedDocumentId(matchingDoc.id);
        setPdfFilename(matchingDoc.filename); // ✅ PDF 파일명 설정 추가
        console.log('✅ 소스 선택 완료:', matchingDoc.title, 'ID:', matchingDoc.id);
      } else {
        console.warn('❌ 문서를 찾을 수 없습니다. sourceId:', sourceId, '전체 문서:', allDocuments.map(d => d.filename));
      }
    } catch (error) {
      console.error('❌ 소스 클릭 오류:', error);
    }
  };

  // 앱 시작 시 PDF 소스 로드 (압축 기능 포함 + 진행률 표시)
  useEffect(() => {
    const initializeSources = async () => {
      try {
        console.log('Starting PDF initialization...');
        
        // PDF 내용을 압축하여 초기화 (비동기 처리)
        const initPromise = geminiService.initializeWithPdfSources();
        
        // 채팅 세션 생성 (PDF 초기화와 병렬 처리)
        const chatPromise = geminiService.createNotebookChatSession();
        
        // 두 작업을 병렬로 실행
        await Promise.all([initPromise, chatPromise]);
        
        // 소스 목록 업데이트 (초기화 완료 후 반드시 실행)
        const loadedSources = geminiService.getSources();
        console.log('📋 로드된 소스 목록:', loadedSources.length, '개');
        if (loadedSources.length === 0) {
          console.warn('⚠️ 소스 목록이 비어있습니다. manifest.json을 확인하세요.');
        } else {
          console.log('📄 소스 파일들:', loadedSources.map(s => s.title));
        }
        setSources(loadedSources);
        
        console.log('Initialization completed successfully');
        setIsInitializing(false);
      } catch (error) {
        console.error('Failed to initialize chat session:', error);
        // 초기화 실패 시에도 소스 목록은 가져오기 시도
        try {
          const fallbackSources = geminiService.getSources();
          if (fallbackSources.length > 0) {
            console.log('✅ 초기화 실패했지만 소스 목록은 로드됨:', fallbackSources.length, '개');
            setSources(fallbackSources);
          } else {
            console.warn('⚠️ 초기화 실패 및 소스 목록도 비어있음');
            // 소스 목록을 다시 로드 시도
            await geminiService.loadDefaultSources();
            const retrySources = geminiService.getSources();
            if (retrySources.length > 0) {
              console.log('✅ 재시도로 소스 목록 로드 성공:', retrySources.length, '개');
              setSources(retrySources);
            }
          }
        } catch (sourceError) {
          console.error('❌ 소스 목록 로드 실패:', sourceError);
        }
        // 초기화 실패 시에도 앱을 계속 실행
        console.warn('초기화에 실패했지만 앱을 계속 실행합니다.');
        setIsInitializing(false);
      }
    };

    // 초기화를 비동기로 실행하여 UI 블로킹 방지
    initializeSources();
  }, []);

  // ✅ 열린 PDF 창 참조 저장 (전역)
  const pdfViewerWindowRef = React.useRef<Window | null>(null);
  
  // ✅ 참조 클릭 이벤트 리스너 - 새 창에서 PDF 열기 또는 기존 창 페이지 이동
  useEffect(() => {
    const handleReferenceClick = (event: CustomEvent) => {
      console.log('📥 App.tsx에서 referenceClick 이벤트 수신:', event.detail);
      const { documentId, chunkId, page, logicalPageNumber, filename, title, questionContent, chunkContent, keywords } = event.detail;
      console.log('📝 설정할 값:', { documentId, chunkId, page, logicalPageNumber, filename, title, questionContent, chunkContent, keywords });
      
      // PDF 파일명과 페이지 정보가 있으면 새 창에서 PDF 열기
      // page는 뷰어 인덱스 (PDF.js에서 사용하는 1-based 인덱스)
      if (filename && page && page > 0) {
        try {
          // PDF URL 생성 (개발/프로덕션 환경 자동 감지)
          const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
          const basePath = isDevelopment ? '/pdf' : '/chat7v/pdf';
          const encodedFilename = encodeURIComponent(filename);
          const pdfUrl = `${basePath}/${encodedFilename}`;
          const absolutePdfUrl = window.location.origin + pdfUrl;
          
          // 하이라이트할 키워드 추출 (개선: 정확하고 적은 키워드만 선택)
          const highlightKeywords: string[] = [];
          let coreSearchText: string | undefined = undefined;
          
          // ✅ 개선: 청크 내용에서 핵심 문구 추출 (20-50자 정도의 짧은 핵심 문장)
          if (chunkContent && chunkContent.length > 0) {
            // 청크 내용의 핵심 문구 추출 (문장 경계에서)
            const sentences = chunkContent.split(/[.。!！?？\n]/).filter(s => s.trim().length >= 10);
            if (sentences.length > 0) {
              // 첫 번째 문장을 핵심 문구로 사용 (30자 이내)
              const corePhrase = sentences[0].trim().substring(0, 30);
              if (corePhrase.length >= 10) {
                // 핵심 문구를 검색 텍스트로 사용 (키워드가 아닌)
                coreSearchText = corePhrase;
              }
            }
          }
          
          // ✅ 개선: 키워드는 최대 3개만 (가장 관련성 높은 것만)
          // 1. 청크 키워드에서 최대 2개 (가장 관련성 높은 것, 20자 이하만)
          if (keywords && Array.isArray(keywords) && keywords.length > 0) {
            const validKeywords = keywords
              .filter(k => k && k.trim().length >= 3 && k.trim().length <= 20)
              .slice(0, 2);
            highlightKeywords.push(...validKeywords);
          }
          
          // 2. 질문에서 핵심 단어 최대 2개 (3글자 이상만)
          if (questionContent) {
            const stopWords = ['은', '는', '이', '가', '을', '를', '에', '의', '와', '과', '도', '만', '조차', '마저', '까지', '부터', '에서', '에게', '한테', '께', '로', '으로', '것', '수', '있', '없', '되', '하', '등', '때', '경우', '위해', '때문'];
            
            const questionWords = questionContent
              .replace(/[^\w가-힣\s]/g, ' ')
              .split(/\s+/)
              .filter(w => {
                const word = w.trim();
                return word.length >= 3 && !stopWords.includes(word); // ✅ 3글자 이상으로 변경
              })
              .map(word => {
                // 조사 제거
                for (const particle of ['은', '는', '이', '가', '을', '를', '에', '의', '와', '과', '도', '만', '에서', '에게', '한테', '께', '로', '으로']) {
                  if (word.endsWith(particle) && word.length > particle.length) {
                    return word.slice(0, -particle.length);
                  }
                }
                return word;
              })
              .filter(w => w.length >= 3) // ✅ 3글자 이상만
              .slice(0, 2); // ✅ 최대 2개만
            
            highlightKeywords.push(...questionWords);
          }
          
          // 중복 제거 및 최대 3개로 제한
          const uniqueKeywords = [...new Set(highlightKeywords)]
            .filter(k => k && k.trim().length >= 3 && k.trim().length <= 20) // ✅ 3~20자만
            .slice(0, 3); // ✅ 최대 3개로 제한
          
          // 기존 PDF 창이 열려있고 닫히지 않았는지 확인
          const existingWindow = pdfViewerWindowRef.current;
          console.log('🔍 기존 창 확인:', {
            exists: !!existingWindow,
            closed: existingWindow?.closed,
            ready: existingWindow && !existingWindow.closed
          });
          
          if (existingWindow && !existingWindow.closed) {
            try {
              const message = {
                type: 'changePage',
                page: page,
                highlight: uniqueKeywords.length > 0 ? uniqueKeywords : undefined,
                searchText: coreSearchText || (chunkContent ? chunkContent.substring(0, 30) : undefined) // ✅ 핵심 문구만 또는 최대 30자
              };
              
              console.log('📤 기존 창에 메시지 전송:', message);
              
              // 기존 창에 페이지 이동 메시지 전송
              existingWindow.postMessage(message, window.location.origin);
              
              // 기존 창을 포커스
              existingWindow.focus();
              
              // 메시지가 제대로 전달되었는지 확인 (간단한 핸들쉐이크)
              setTimeout(() => {
                // 응답 확인을 위해 다시 한 번 포커스 (메시지 처리 확인)
                if (existingWindow && !existingWindow.closed) {
                  console.log(`✅ 기존 PDF 창으로 페이지 ${page} 이동 메시지 전송 완료`);
                } else {
                  console.warn('⚠️ 기존 창이 닫혔습니다.');
                  pdfViewerWindowRef.current = null;
                }
              }, 100);
              
              return; // 새 창을 열지 않고 종료
            } catch (error) {
              console.error('❌ 기존 창에 메시지 전송 실패:', error);
              // 기존 창 참조 초기화
              pdfViewerWindowRef.current = null;
            }
          }
          
          // 뷰어 URL 생성 (하이라이트 키워드 포함)
          const params = new URLSearchParams({
            url: absolutePdfUrl,
            page: page.toString(),
            title: title || filename
          });
          
          if (uniqueKeywords.length > 0) {
            params.append('highlight', uniqueKeywords.join(','));
            console.log('📄 하이라이트 키워드:', uniqueKeywords);
          }
          
          // ✅ 개선: 청크 내용도 전달 (핵심 문구만 또는 최대 30자)
          if (coreSearchText) {
            params.append('searchText', coreSearchText);
          } else if (chunkContent) {
            const contentSnippet = chunkContent.substring(0, 30);
            params.append('searchText', contentSnippet);
          }
          
          const viewerUrl = `/chat7v/pdf-viewer.html?${params.toString()}`;
          
          console.log('📄 PDF 뷰어 URL:', viewerUrl);
          console.log('📄 PDF 파일 URL:', absolutePdfUrl);
          
          // 새 창 열기 (사용자 상호작용 직후이므로 팝업 차단되지 않음)
          const newWindow = window.open(
            viewerUrl, 
            'pdfViewer',
            'width=1200,height=800,scrollbars=yes,resizable=yes,toolbar=no,location=no,menubar=no'
          );
          
          if (newWindow) {
            // 새 창 참조 저장
            pdfViewerWindowRef.current = newWindow;
            console.log(`✅ 새 창 열기 성공: ${filename}, 페이지 ${page}`);
            
            // 새 창이 닫혔는지 확인
            const checkClosed = setInterval(() => {
              if (newWindow.closed) {
                clearInterval(checkClosed);
                pdfViewerWindowRef.current = null; // 참조 제거
                console.log('📄 PDF 뷰어 창이 닫혔습니다.');
              }
            }, 1000);
          } else {
            console.error('❌ 새 창 열기 실패 - 팝업이 차단되었을 수 있습니다.');
            // 팝업이 차단된 경우 현재 창에서 열기 시도
            const confirmOpen = window.confirm('팝업이 차단되었습니다. 현재 창에서 PDF를 열까요?');
            if (confirmOpen) {
              window.location.href = viewerUrl;
            }
          }
        } catch (error) {
          console.error('❌ PDF 뷰어 열기 오류:', error);
        }
      }
      // ✅ PDF 정보가 있으면 좌측 텍스트 뷰는 변경하지 않음 (PDF 뷰어만 제어)
      // ✅ PDF 정보가 없을 때만 텍스트 뷰로 폴백 (선택적)
      // else if (documentId && chunkId) {
      //   // PDF 정보가 없을 때만 텍스트 뷰 표시 (필요시 주석 해제)
      //   setSelectedDocumentId(documentId);
      //   setHighlightedChunkId(chunkId);
      //   setQuestionContent(questionContent || '');
      //   setPdfViewerMode('text');
      //   console.log('📄 텍스트 뷰로 표시 (PDF 정보 없음)');
      // }
    };

    window.addEventListener('referenceClick', handleReferenceClick as EventListener);
    return () => window.removeEventListener('referenceClick', handleReferenceClick as EventListener);
  }, []);

  const handleSendMessage = useCallback(async (message: string): Promise<string> => {
    return await geminiService.generateResponse(message);
  }, []);

  const handleStreamingMessage = useCallback(async (message: string): Promise<AsyncGenerator<string, void, unknown>> => {
    return await geminiService.generateStreamingResponse(message);
  }, []);

  const handleResetMessages = useCallback(() => {
    setMessages([]);
  }, []);


  const handleResetChat = () => {
    setShowResetConfirm(true);
  };

  const confirmReset = async () => {
    try {
      setShowResetConfirm(false);
      
      // 1. 현재 채팅 세션 초기화
      await geminiService.resetChatSession();
      
      // 2. 메시지 목록 초기화 (ChatWindow에서 관리하는 메시지들)
      setMessages([]);
      
      // 3. ChatWindow 강제 리렌더링을 위한 키 변경
      setChatKey(prev => prev + 1);
      
      // 4. 소스 목록을 다시 로드하여 최신 상태 유지
      await geminiService.initializeWithPdfSources();
      setSources(geminiService.getSources());
      
      console.log('새 대화가 시작되었습니다.');
    } catch (error) {
      console.error('Failed to reset chat session:', error);
    }
  };

  // ESC 키로 소스 뷰어 닫기
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedDocumentId) {
        setSelectedDocumentId(undefined);
        setHighlightedChunkId(undefined);
        setQuestionContent(''); // ✅ 질문 내용도 초기화
        console.log('ESC 키로 소스 뷰어 닫기');
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [selectedDocumentId]);

  // ✅ 브라우저 뒤로가기 버튼으로 소스 뷰어 닫기
  useEffect(() => {
    // 문서가 선택될 때마다 히스토리 엔트리 추가
    if (selectedDocumentId) {
      // 이미 추가된 경우 중복 방지
      const currentState = window.history.state;
      if (!currentState || !currentState.hasDocumentViewer) {
        window.history.pushState({ hasDocumentViewer: true }, '', window.location.href);
      }
    }
  }, [selectedDocumentId]);

  // ✅ popstate 이벤트 감지 (브라우저 뒤로가기)
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      // 문서 뷰어가 열려있을 때 뒤로가기를 누르면 문서 선택 해제
      if (selectedDocumentId) {
        // 브라우저 뒤로가기 기본 동작을 막지 않고, 상태만 업데이트
        setSelectedDocumentId(undefined);
        setHighlightedChunkId(undefined);
        setQuestionContent(''); // ✅ 질문 내용도 초기화
        console.log('브라우저 뒤로가기로 소스 뷰어 닫기');
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [selectedDocumentId]);

  if (isInitializing) {
    return (
      <div className="min-h-screen bg-brand-bg text-brand-text-primary flex items-center justify-center">
        <div className="text-center max-w-md mx-auto px-4">
          <div className="relative mb-6">
            <div className="w-16 h-16 border-4 border-brand-secondary rounded-full mx-auto"></div>
            <div className="w-16 h-16 border-4 border-brand-primary border-t-transparent rounded-full animate-spin absolute top-0 left-1/2 transform -translate-x-1/2"></div>
          </div>
          <h2 className="text-2xl font-bold text-brand-text-primary mb-3">AI 사업문의 지원 Chatbot6v</h2>
          <p className="text-brand-text-secondary mb-4">문서를 준비하고 있습니다...</p>
          <div className="space-y-2 text-sm text-brand-text-secondary">
            <div className="flex items-center justify-center space-x-2">
              <div className="w-2 h-2 bg-brand-primary rounded-full animate-pulse"></div>
              <span>사전 처리된 데이터 로딩 중...</span>
            </div>
            <div className="flex items-center justify-center space-x-2">
              <div className="w-2 h-2 bg-brand-primary rounded-full animate-pulse" style={{animationDelay: '0.2s'}}></div>
              <span>PDF 문서 파싱 중 (폴백 모드)</span>
            </div>
            <div className="flex items-center justify-center space-x-2">
              <div className="w-2 h-2 bg-brand-primary rounded-full animate-pulse" style={{animationDelay: '0.4s'}}></div>
              <span>AI 모델 준비 중...</span>
            </div>
          </div>
          <div className="mt-6 text-xs text-brand-text-secondary">
            잠시만 기다려주세요. 첫 로딩은 시간이 걸릴 수 있습니다.
          </div>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-brand-bg text-brand-text-primary">
      <div className="h-screen flex flex-col">
        <header className="bg-brand-surface border-b border-brand-secondary p-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-4">
              {/* 모바일 메뉴 버튼 */}
              <button
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className="md:hidden p-2 rounded-lg bg-brand-secondary hover:bg-opacity-80 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              
              <div>
                <h1 className="text-xl md:text-2xl font-bold text-brand-primary">
                  AI 사업문의 지원 Chatbot 6V
                </h1>
                <p className="text-brand-text-secondary text-xs md:text-sm mt-1">
                  금연사업 관련 문의사항을 AI가 도와드립니다
                </p>
              </div>
            </div>
            
            <div className="flex gap-2 mr-16">
              {/* 고급 검색 테스트 버튼 숨김 */}
              {false && (
                <button
                  onClick={() => setShowAdvancedSearchTest(true)}
                  className="px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm"
                >
                  🧪 고급 검색 테스트
                </button>
              )}
              <button
                onClick={() => setShowCompressionStats(true)}
                className="px-3 py-2 bg-brand-secondary text-brand-text-primary rounded-lg hover:bg-opacity-80 transition-colors text-xs md:text-sm"
              >
                사용량 통계
              </button>
              <button
                onClick={handleResetChat}
                className="px-3 py-2 bg-brand-secondary text-brand-text-primary rounded-lg hover:bg-opacity-80 transition-colors text-xs md:text-sm"
              >
                새 대화 시작
              </button>
            </div>
          </div>
        </header>

        <div className="flex-1 flex relative overflow-hidden">
          {/* 모바일 오버레이 */}
          {isSidebarOpen && (
            <div 
              className="fixed inset-0 bg-black bg-opacity-50 z-40 md:hidden"
              onClick={() => setIsSidebarOpen(false)}
            />
          )}

          {/* 사이드바 - 소스 관리 */}
          <div 
            className={`
              fixed md:relative z-50 md:z-auto
              bg-brand-surface border-r border-brand-secondary overflow-hidden
              transform transition-transform duration-300 ease-in-out
              ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
              md:translate-x-0 md:block md:flex-shrink md:flex-grow-0
              flex flex-col
              h-full
            `}
            style={{ 
              width: `${sidebarWidth}px`, 
              minWidth: '250px',
              maxWidth: '800px'
            }}
          >
            {/* 사이드바 헤더 (고정) - SourceViewer가 있을 때는 제목 없이 뒤로가기 버튼만 */}
            {selectedDocumentId && (
              <div className="p-4 pb-2 flex-shrink-0">
                <div className="flex justify-between items-center">
                  <button
                    onClick={() => {
                      setSelectedDocumentId(undefined);
                      setHighlightedChunkId(undefined);
                    }}
                    className="p-1 rounded-lg hover:bg-brand-secondary transition-colors"
                    title="돌아가기"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setIsSidebarOpen(false)}
                    className="md:hidden p-1 rounded-lg hover:bg-brand-secondary"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            )}
            
            {/* 자료 출처 모드일 때만 제목 표시 */}
            {!selectedDocumentId && (
              <div className="p-4 pb-2 border-b border-brand-secondary flex-shrink-0">
                <div className="flex justify-between items-center">
                  <h2 className="text-lg font-semibold text-brand-text-primary">
                    자료 출처
                  </h2>
                  <button
                    onClick={() => setIsSidebarOpen(false)}
                    className="md:hidden p-1 rounded-lg hover:bg-brand-secondary"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            )}

            {/* 사이드바 내용 (스크롤은 각 컴포넌트가 담당) */}
            <div className="flex-1">
              {selectedDocumentId ? (
                <SourceViewer
                  selectedDocumentId={selectedDocumentId}
                  highlightedChunkId={highlightedChunkId}
                  questionContent={questionContent}
                  onChunkSelect={(chunkId) => {
                    if (chunkId === '') {
                      setHighlightedChunkId(undefined);
                      setQuestionContent(''); // ✅ 질문 내용 초기화
                    } else {
                      setHighlightedChunkId(chunkId);
                    }
                  }}
                  pdfViewerMode={pdfViewerMode}
                  pdfCurrentPage={pdfCurrentPage}
                  pdfFilename={pdfFilename}
                  onPdfPageChange={(page) => {
                    setPdfCurrentPage(page);
                    
                    // ✅ 좌측 텍스트 뷰 스크롤 시 PDF 창도 실시간 동기화
                    const existingWindow = pdfViewerWindowRef.current;
                    if (existingWindow && !existingWindow.closed) {
                      try {
                        console.log(`🔄 텍스트 뷰 페이지 변경 → PDF 창 동기화: ${page}`);
                        existingWindow.postMessage({
                          type: 'changePage',
                          page: page
                        }, window.location.origin);
                      } catch (error) {
                        console.warn('⚠️ PDF 창 동기화 실패:', error);
                      }
                    }
                  }}
                  onViewModeChange={(mode) => setPdfViewerMode(mode)}
                />
              ) : (
                <div className="p-4 space-y-2 h-full overflow-y-auto sidebar-scroll">
                  <h3 className="text-md font-medium text-brand-text-primary">현재 자료</h3>
                  <SourceInfo sources={sources} onSourceClick={handleSourceClick} />
                </div>
              )}
            </div>
            
            {/* 리사이즈 핸들 */}
            <div
              className="absolute top-0 right-0 w-1 h-full cursor-col-resize bg-transparent hover:bg-blue-500 transition-colors z-10 md:block hidden"
              onMouseDown={handleResizeStart}
              style={{
                transition: isResizing ? 'none' : 'background-color 0.2s'
              }}
            >
              {/* 핸들 시각적 표시 */}
              <div className="absolute top-1/2 right-0 transform -translate-y-1/2 w-1 h-16 bg-gray-400 rounded-r opacity-0 hover:opacity-100 transition-opacity" />
            </div>
          </div>

          {/* ✅ 채팅 화면 (전체 너비) - 사이드바 확장 시에도 보이도록 수정 */}
          <div className={`flex-1 min-w-[300px] max-w-full ${isResizing ? 'opacity-90' : 'opacity-100'} transition-opacity duration-200`} style={{ flexShrink: 1 }}>
            <div className="flex-1 flex flex-col min-w-0 h-full">
              <ChatWindow
                key="chat-window" // ✅ 고정 키 사용 (리사이즈나 SourceViewer 변경 시에도 유지)
                onSendMessage={handleSendMessage}
                onStreamingMessage={handleStreamingMessage}
                onResetMessages={handleResetMessages} // ✅ 메모이제이션된 함수 사용
                resetTrigger={chatKey} // 이 값이 변경될 때만 리셋
                placeholder="금연사업 관련 문의사항을 입력하세요..."
              />
            </div>
          </div>
        </div>
      </div>

      {/* 압축 통계 모달 */}
      <CompressionStats
        compressionResult={geminiService.getCompressionStats()}
        isVisible={showCompressionStats}
        onClose={() => setShowCompressionStats(false)}
      />

      {/* 새 대화 시작 확인 다이얼로그 */}
      <ConfirmDialog
        isOpen={showResetConfirm}
        title="새 대화 시작"
        message="현재 대화 내용이 모두 삭제됩니다. 계속하시겠습니까?"
        confirmText="새 대화 시작"
        cancelText="취소"
        onConfirm={confirmReset}
        onCancel={() => setShowResetConfirm(false)}
        isDestructive={true}
      />

      {/* Firestore 캐시 관리자 */}
      <FirestoreCacheManager />

      {/* 고급 검색 테스트 모달 */}
      {showAdvancedSearchTest && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-6xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">🚀 고급 검색 품질 테스트</h2>
              <button
                onClick={() => setShowAdvancedSearchTest(false)}
                className="text-gray-500 hover:text-gray-700 text-2xl"
              >
                ×
              </button>
            </div>
            <AdvancedSearchTest />
          </div>
        </div>
      )}
    </div>
    </TooltipProvider>
  );
}

export default App;