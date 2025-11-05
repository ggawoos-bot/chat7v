import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
// CSS 스타일 import (react-pdf의 스타일)
// Note: react-pdf v10에서는 CSS가 자동으로 포함되지만, 필요시 명시적으로 import

// PDF.js Worker 파일 경로 설정 (최적화된 버전)
if (typeof window !== 'undefined') {
  // CDN을 기본으로 사용 (안정적이고 빠름)
  // 로컬 worker가 필요하면 나중에 변경 가능
  const pdfjsVersion = pdfjs.version || '3.11.174';
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsVersion}/pdf.worker.min.js`;
  console.log(`📦 PDF.js Worker 설정 (CDN): v${pdfjsVersion}`);
}

interface EmbedPdfViewerProps {
  pdfUrl: string;
  currentPage?: number;
  onPageChange?: (page: number) => void;
  onDocumentLoad?: (totalPages: number) => void;
  onError?: (error: string) => void;
}

export const EmbedPdfViewer: React.FC<EmbedPdfViewerProps> = ({
  pdfUrl,
  currentPage = 1,
  onPageChange,
  onDocumentLoad,
  onError
}) => {
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(currentPage);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // PDF URL을 절대 경로로 변환 (개선된 버전)
  const absolutePdfUrl = useMemo(() => {
    if (!pdfUrl || pdfUrl.trim() === '') {
      console.warn('⚠️ PDF URL이 없습니다:', pdfUrl);
      return '';
    }
    
    const trimmedUrl = pdfUrl.trim();
    
    // 이미 절대 URL인 경우 그대로 사용
    if (trimmedUrl.startsWith('http://') || trimmedUrl.startsWith('https://')) {
      return trimmedUrl;
    }
    
    // 상대 경로 처리
    if (trimmedUrl.startsWith('./')) {
      return `${window.location.origin}${trimmedUrl.substring(1)}`;
    }
    
    // 절대 경로로 시작하는 경우
    if (trimmedUrl.startsWith('/')) {
      return `${window.location.origin}${trimmedUrl}`;
    }
    
    // 기본적으로 현재 도메인 기준으로 처리
    return `${window.location.origin}/${trimmedUrl}`;
  }, [pdfUrl]);

  // PDF 파일 유효성 검사 (HEAD 요청으로 파일 존재 확인)
  const [isValidPdf, setIsValidPdf] = useState<boolean | null>(null);
  
  useEffect(() => {
    if (!absolutePdfUrl) {
      setIsValidPdf(null);
      return;
    }

    // PDF 파일 존재 여부 확인
    const checkPdfExists = async () => {
      try {
        const response = await fetch(absolutePdfUrl, { 
          method: 'HEAD',
          cache: 'no-cache'
        });
        setIsValidPdf(response.ok && response.headers.get('content-type')?.includes('pdf'));
        
        if (!response.ok) {
          console.warn(`⚠️ PDF 파일을 찾을 수 없음: ${response.status} ${response.statusText}`);
        }
      } catch (error) {
        console.error('❌ PDF 파일 검사 실패:', error);
        setIsValidPdf(false);
      }
    };

    checkPdfExists();
  }, [absolutePdfUrl]);

  // PDF URL 변경 시 로딩 상태 초기화
  useEffect(() => {
    if (absolutePdfUrl) {
      console.log('📄 PDF URL 준비:', absolutePdfUrl);
      setLoading(true);
      setError(null);
      setNumPages(0);
      setPageNumber(currentPage);
    } else {
      console.warn('⚠️ PDF URL이 유효하지 않습니다');
      setLoading(false);
      setError('PDF URL이 제공되지 않았습니다.');
    }
  }, [absolutePdfUrl, currentPage]);

  // currentPage가 변경되면 pageNumber 업데이트
  useEffect(() => {
    if (currentPage > 0 && currentPage <= numPages) {
      setPageNumber(currentPage);
    } else if (currentPage > 0 && numPages === 0) {
      // numPages가 아직 로드되지 않은 경우 currentPage를 일단 설정
      setPageNumber(currentPage);
    }
  }, [currentPage, numPages]);

  // PDF 로드 성공 처리
  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    console.log(`✅ PDF 로드 성공: ${numPages}페이지, URL: ${absolutePdfUrl}`);
    setNumPages(numPages);
    setLoading(false);
    setError(null);
    onDocumentLoad?.(numPages);
    
    // currentPage가 유효한 범위인지 확인
    if (currentPage > 0 && currentPage <= numPages) {
      setPageNumber(currentPage);
      onPageChange?.(currentPage);
    } else {
      setPageNumber(1);
      onPageChange?.(1);
    }
  };

  // PDF 로드 에러 처리 (개선된 버전)
  const onDocumentLoadError = useCallback((error: Error) => {
    console.error('❌ PDF 로드 오류:', error);
    console.error('❌ PDF URL:', absolutePdfUrl);
    
    // 에러 타입별 상세 메시지
    let errorMessage = `PDF 로드 실패: ${error.message}`;
    
    if (error.message.includes('Missing PDF')) {
      errorMessage = 'PDF 파일을 찾을 수 없습니다. 파일 경로를 확인하세요.';
    } else if (error.message.includes('Invalid PDF')) {
      errorMessage = '유효하지 않은 PDF 파일입니다.';
    } else if (error.message.includes('Network')) {
      errorMessage = '네트워크 오류가 발생했습니다. 연결을 확인하세요.';
    }
    
    setError(errorMessage);
    setLoading(false);
    onError?.(errorMessage);
  }, [absolutePdfUrl, onError]);

  // 재시도 함수
  const handleRetry = useCallback(() => {
    setError(null);
    setLoading(true);
    setNumPages(0);
    setPageNumber(1);
  }, []);

  // 페이지 변경 처리
  const changePage = (offset: number) => {
    const newPage = pageNumber + offset;
    if (newPage >= 1 && newPage <= numPages) {
      setPageNumber(newPage);
      onPageChange?.(newPage);
    }
  };

  const goToPage = (page: number) => {
    if (page >= 1 && page <= numPages) {
      setPageNumber(page);
      onPageChange?.(page);
    }
  };

  // PDF URL이 없는 경우 명확한 에러 메시지 표시
  if (!absolutePdfUrl) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="text-red-500 mb-4 text-lg">❌ PDF URL 오류</div>
          <div className="text-gray-600 mb-4 text-sm">PDF 파일을 찾을 수 없습니다.</div>
          <div className="text-gray-500 text-xs">파일명이 제공되지 않았습니다.</div>
          <div className="text-gray-400 text-xs mt-2">URL: {pdfUrl || '(없음)'}</div>
        </div>
      </div>
    );
  }

  // PDF 파일이 유효하지 않은 경우 (검사 완료 후)
  if (isValidPdf === false && !loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="text-red-500 mb-4 text-lg">❌ PDF 파일을 찾을 수 없음</div>
          <div className="text-gray-600 mb-4 text-sm">해당 경로에 PDF 파일이 존재하지 않습니다.</div>
          <div className="text-gray-500 text-xs mb-4">URL: {absolutePdfUrl}</div>
          <button
            onClick={handleRetry}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
          >
            다시 시도
          </button>
        </div>
      </div>
    );
  }

  if (loading && !error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500">PDF 문서 로딩 중...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="text-red-500 mb-4 text-lg">❌ PDF 로드 실패</div>
          <div className="text-gray-600 mb-4 text-sm">{error}</div>
          <div className="text-gray-500 text-xs mb-4">URL: {absolutePdfUrl}</div>
          <button
            onClick={handleRetry}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
          >
            다시 시도
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white">
      {/* 헤더 컨트롤 */}
      <div className="flex items-center justify-between p-4 border-b bg-gray-50 flex-shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={() => changePage(-1)}
            disabled={pageNumber <= 1}
            className="px-3 py-1 bg-blue-500 text-white rounded disabled:opacity-50 hover:bg-blue-600 transition-colors"
            title="이전 페이지"
          >
            ← 이전
          </button>
          <span className="text-sm font-medium">
            페이지 {pageNumber} / {numPages || '?'}
          </span>
          <button
            onClick={() => changePage(1)}
            disabled={pageNumber >= numPages}
            className="px-3 py-1 bg-blue-500 text-white rounded disabled:opacity-50 hover:bg-blue-600 transition-colors"
            title="다음 페이지"
          >
            다음 →
          </button>
        </div>
        
        <div className="flex items-center gap-2">
          <input
            type="number"
            min="1"
            max={numPages || 1}
            value={pageNumber}
            onChange={(e) => goToPage(parseInt(e.target.value) || 1)}
            className="w-16 px-2 py-1 border rounded text-sm text-center"
          />
          <span className="text-sm text-gray-600">페이지</span>
        </div>
      </div>

      {/* PDF 뷰어 */}
      <div className="flex-1 overflow-auto bg-gray-100 p-4 flex items-start justify-center">
        {absolutePdfUrl ? (
          <Document
            key={absolutePdfUrl} // PDF URL이 변경될 때 Document를 완전히 리마운트
            file={absolutePdfUrl}
            onLoadSuccess={onDocumentLoadSuccess}
            onLoadError={onDocumentLoadError}
            loading={
              <div className="flex items-center justify-center" style={{ minHeight: '400px' }}>
                <div className="text-gray-500">PDF 로딩 중...</div>
              </div>
            }
            error={
              <div className="flex items-center justify-center" style={{ minHeight: '400px' }}>
                <div className="text-red-500">PDF 로드 실패</div>
              </div>
            }
          >
            <Page
              pageNumber={pageNumber}
              renderTextLayer={true}
              renderAnnotationLayer={true}
              className="shadow-lg"
              width={window.innerWidth > 768 ? 800 : window.innerWidth - 64}
              loading={
                <div className="flex items-center justify-center" style={{ minHeight: '600px' }}>
                  <div className="text-gray-500">페이지 로딩 중...</div>
                </div>
              }
              onLoadError={(error) => {
                console.error('페이지 로드 오류:', error);
              }}
              onRenderError={(error) => {
                console.error('페이지 렌더링 오류:', error);
              }}
            />
          </Document>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-gray-500">PDF URL이 없습니다.</div>
          </div>
        )}
      </div>
    </div>
  );
};

export default EmbedPdfViewer;
