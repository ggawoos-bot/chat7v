# PDF 뷰어 문제 상세 분석 보고서

## 🔍 발견된 문제점 요약

콘솔 로그와 소스 코드 분석 결과, 다음 문제들이 확인되었습니다:

1. **PDF 버튼 클릭 시 모드 전환이 제대로 작동하지 않음**
2. **모든 청크의 page 번호가 0으로 저장되어 있음**
3. **PDF 최대 페이지가 0으로 계산됨**
4. **PDF 파일명이 제대로 전달되지 않을 수 있음**

---

## 📋 상세 분석

### 문제 1: PDF 버튼 클릭 시 모드 전환 문제

**위치**: `components/SourceViewer.tsx` (314-318줄)

```typescript
<button
  onClick={() => {
    console.log('📄 PDF 버튼 클릭됨, 현재 모드:', pdfViewerMode);
    console.log('📄 PDF URL:', pdfUrl);
    console.log('📄 PDF 파일명:', pdfFilename || document?.filename);
    onViewModeChange?.('pdf');
  }}
```

**문제점**:
- `onViewModeChange` 함수가 호출되지만, 실제로 `pdfViewerMode`가 업데이트되지 않는 것처럼 보임
- 콘솔 로그에서 "현재 모드: text"가 계속 출력되는 것은 **리액트 상태 업데이트의 비동기성** 때문일 수 있음
- 하지만 실제 문제는 **다른 곳**에 있을 가능성이 높음

**원인 분석**:
1. `App.tsx` 445줄에서 `onViewModeChange`가 올바르게 연결되어 있음:
   ```typescript
   onViewModeChange={(mode) => setPdfViewerMode(mode)}
   ```
2. **실제 문제**: PDF 모드로 전환되어도 **PDF URL이 비어있거나 유효하지 않으면** EmbedPdfViewer가 로드되지 않음
3. **추가 문제**: `pdfViewerMode === 'pdf'` 조건에서 `pdfUrl`이 빈 문자열일 경우 로딩 상태가 계속 유지될 수 있음

---

### 문제 2: 페이지 번호가 모두 0인 문제 ⚠️ **핵심 문제**

**위치**: `components/SourceViewer.tsx` (37-79줄, `chunksByPage` useMemo)

**현재 상황**:
- 콘솔 로그: `"🔍 모든 청크의 page가 0: true"`
- 콘솔 로그: `"📄 PDF 최대 페이지: 0"`
- 콘솔 로그: `"📋 청크가 있는 페이지: 1개 (0)"`

**원인 분석**:

#### 2-1. 청크 데이터의 page 정보가 0인 이유 ⚠️ **근본 원인 발견**

**위치**: `scripts/migrate-to-firestore.js` (174-201줄, 254-269줄)

**발견된 문제**:
PDF 청크를 생성할 때 **`metadata.page` 정보를 전혀 저장하지 않고 있습니다!**

```javascript
// saveChunkToFirestore 함수 (174-201줄)
const chunkData = {
  documentId: documentId,
  filename: filename,
  content: chunk,
  keywords: keywords,
  metadata: {
    position: index,
    startPos: position,
    endPos: position + chunk.length,
    originalSize: chunk.length,
    source: 'Direct PDF Processing'
    // ❌ page 필드가 없음!
  },
  // ...
};

// processChunksStreaming 함수 (254-269줄)
chunkDataList.push({
  documentId: documentId,
  filename: filename,
  content: chunk.trim(),
  keywords: keywords,
  metadata: {
    position: chunkIndex,
    startPos: position,
    endPos: position + chunk.length,
    originalSize: chunk.length,
    source: 'Direct PDF Processing'
    // ❌ page 필드가 없음!
  },
  // ...
});
```

**결과**:
- Firestore에 저장된 모든 청크의 `metadata.page`는 `undefined` 또는 기본값(0)임
- 따라서 `chunk.metadata?.page || 0`은 항상 0을 반환

**해결 방법**:
PDF 처리 스크립트에서 실제 PDF의 페이지 정보를 추출하여 `metadata.page`에 저장해야 함.

**상세 설명**:
- `parsePdfFile` 함수 (80-97줄)는 `pdf-parse` 라이브러리를 사용하여 전체 텍스트만 추출함
- `pdfData.pages`에는 총 페이지 수만 있고, 각 텍스트 청크가 어떤 페이지에 속하는지 정보가 없음
- 따라서 청크를 생성할 때 텍스트 위치(`position`)와 총 페이지 수를 기반으로 페이지 번호를 추정해야 함

**제안하는 해결책**:
```javascript
// processChunksStreaming 함수 수정
// 청크의 position을 기반으로 페이지 번호 계산
const calculatePageNumber = (textPosition, totalTextLength, totalPages) => {
  if (totalPages === 0 || totalTextLength === 0) return 1;
  const pageNumber = Math.floor((textPosition / totalTextLength) * totalPages) + 1;
  return Math.min(pageNumber, totalPages); // 최대 페이지 수 제한
};

// 청크 생성 시
metadata: {
  position: chunkIndex,
  startPos: position,
  endPos: position + chunk.length,
  originalSize: chunk.length,
  source: 'Direct PDF Processing',
  page: calculatePageNumber(position, text.length, pdfData.pages) // ✅ 추가
}
```

#### 2-2. 페이지 추정 로직의 문제

**위치**: `components/SourceViewer.tsx` (42-77줄)

```typescript
const allPagesZero = chunks.length > 0 && chunks.every(c => !c.metadata?.page || c.metadata.page === 0);

chunks.forEach((chunk, index) => {
  let pageNum;
  
  if (allPagesZero) {
    // 문서의 실제 총 페이지 수가 있으면 청크를 균등 분배
    if (documentTotalPages > 0) {
      pageNum = Math.floor((index / chunks.length) * documentTotalPages) + 1;
      pageNum = Math.min(pageNum, documentTotalPages);
    } else {
      // 문서 총 페이지 수가 없으면 기본 3개 청크 = 1페이지
      const chunksPerPage = 3;
      pageNum = Math.floor(index / chunksPerPage) + 1;
    }
  } else {
    pageNum = chunk.metadata?.page || 0;
  }
  
  // ... pageNum이 0이면 maxPage도 0이 됨
  if (pageNum > maxPage) {
    maxPage = pageNum;
  }
});
```

**문제점**:
1. **조건부 로직의 타이밍 문제**: `allPagesZero`를 체크할 때 `documentTotalPages`가 아직 설정되지 않았을 수 있음
   - `documentTotalPages`는 `loadChunks` 함수에서 비동기로 설정됨 (180줄)
   - `chunksByPage` useMemo는 `documentTotalPages`를 의존성으로 가지지만, 초기 렌더링 시점에는 0일 수 있음

2. **maxPdfPage 업데이트 실패**: `setMaxPdfPage(maxPage)`가 `useMemo` 내부에서 호출되고 있음 (75줄)
   - React의 상태 업데이트는 `useMemo` 내부에서 직접 호출하면 안 됨 (Side Effect)
   - 따라서 `maxPdfPage`가 제대로 업데이트되지 않을 수 있음

---

### 문제 3: PDF URL 생성 및 전달 문제

**위치**: `components/SourceViewer.tsx` (92-97줄)

```typescript
const pdfUrl = useMemo(() => {
  const filename = pdfFilename || document?.filename || '';
  if (!filename) return '';
  const encodedFilename = encodeURIComponent(filename);
  return `/chat7v/pdf/${encodedFilename}`;
}, [pdfFilename, document?.filename]);
```

**문제점**:

1. **파일명이 비어있을 경우 URL이 비어있음**
   - `pdfFilename` prop이 전달되지 않으면
   - `document?.filename`도 없으면
   - 빈 문자열이 반환되어 `EmbedPdfViewer`가 로드할 URL이 없음

2. **파일명 전달 경로 추적**:
   - `App.tsx`에서 `pdfFilename` 상태를 관리 (31줄)
   - `referenceClick` 이벤트에서만 `pdfFilename`을 설정 (204-206줄)
   - **소스를 직접 클릭했을 때는 `pdfFilename`이 설정되지 않음!**
   - 따라서 `SourceViewer`에 `pdfFilename` prop이 전달되지 않음

3. **App.tsx 443줄**: `pdfFilename={pdfFilename}` prop 전달 확인
   - 하지만 소스를 클릭했을 때 `pdfFilename` 상태가 업데이트되지 않음
   - `handleSourceClick` 함수에서 `pdfFilename`을 설정하지 않음

---

### 문제 4: PDF 문서 로드 실패 원인

**위치**: `components/EmbedPdfViewer.tsx`

#### 4-1. PDF URL이 비어있을 경우

```typescript
// 33-56줄: absolutePdfUrl 생성
const absolutePdfUrl = React.useMemo(() => {
  if (!pdfUrl) {
    console.warn('⚠️ PDF URL이 없습니다:', pdfUrl);
    return '';
  }
  // ...
}, [pdfUrl]);

// 59-71줄: URL이 없으면 로딩 상태로 유지
useEffect(() => {
  if (absolutePdfUrl) {
    // ...
  } else {
    console.warn('⚠️ PDF URL이 유효하지 않습니다');
    setLoading(false);
    setError('PDF URL이 제공되지 않았습니다.');
  }
}, [absolutePdfUrl, currentPage]);
```

**문제**: URL이 비어있으면 에러 상태가 되지만, 실제로는 로딩 중 메시지가 계속 표시될 수 있음

#### 4-2. PDF.js Worker 로드 문제

**위치**: `components/EmbedPdfViewer.tsx` (4-10줄)

```typescript
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

if (typeof window !== 'undefined') {
  pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker;
  console.log('📦 PDF.js Worker 로드: 로컬 파일 사용', pdfjsWorker);
}
```

**문제점**:
- Vite 빌드 환경에서 `?url` import가 제대로 동작하지 않을 수 있음
- Worker 파일 경로가 잘못되었을 가능성

---

## 🔧 해결 방안

### 해결책 1: PDF 파일명을 소스 클릭 시 설정

**위치**: `App.tsx` `handleSourceClick` 함수

```typescript
// 145-147줄 수정 필요
if (matchingDoc) {
  setSelectedDocumentId(matchingDoc.id);
  setPdfFilename(matchingDoc.filename); // ✅ 추가 필요
  console.log('✅ 소스 선택 완료:', matchingDoc.title, 'ID:', matchingDoc.id);
}
```

### 해결책 2: maxPdfPage 상태 업데이트 로직 수정

**위치**: `components/SourceViewer.tsx`

`chunksByPage` useMemo 내부에서 `setMaxPdfPage`를 직접 호출하지 말고, 별도의 `useEffect`로 분리:

```typescript
// chunksByPage 계산 후 maxPage 추출
useEffect(() => {
  const pages = Object.keys(chunksByPage).map(Number);
  const maxPage = pages.length > 0 ? Math.max(...pages) : 0;
  setMaxPdfPage(maxPage);
}, [chunksByPage]);
```

### 해결책 3: documentTotalPages 설정 타이밍 개선

**위치**: `components/SourceViewer.tsx` `loadChunks` 함수

문서 정보를 먼저 로드한 후 청크를 로드하도록 보장:

```typescript
const loadChunks = async (documentId: string) => {
  setIsLoading(true);
  try {
    // ✅ 문서 정보를 먼저 로드
    const document = await firestoreService.getDocumentById(documentId);
    if (document) {
      setDocument(document);
      setDocumentTitle(document.title);
      setDocumentTotalPages(document.totalPages || 0);
      console.log(`📄 문서 정보: ${document.title}, 총 페이지: ${document.totalPages}`);
    }
    
    // ✅ 그 다음 청크 로드 (documentTotalPages가 이미 설정됨)
    const chunks = await firestoreService.getChunksByDocument(documentId);
    setChunks(chunks);
    
    // ... 나머지 로직
  }
}
```

### 해결책 4: PDF URL 유효성 검사 강화

**위치**: `components/EmbedPdfViewer.tsx`

빈 URL일 경우 명확한 에러 메시지 표시:

```typescript
if (!absolutePdfUrl) {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <div className="text-red-500 mb-4 text-lg">❌ PDF URL 오류</div>
        <div className="text-gray-600 mb-4 text-sm">PDF 파일을 찾을 수 없습니다.</div>
      </div>
    </div>
  );
}
```

---

## 📝 우선순위별 수정 필요 사항

### 🔴 긴급 (즉시 수정 필요)
1. **`App.tsx` `handleSourceClick`에 `setPdfFilename` 추가**
   - 소스 클릭 시 파일명이 설정되지 않아 PDF URL이 생성되지 않음

### 🟠 중요 (핵심 기능 복구)
2. **`SourceViewer.tsx` `maxPdfPage` 상태 업데이트 로직 수정**
   - useMemo 내부에서 setState 호출 제거

3. **`SourceViewer.tsx` `loadChunks` 순서 보장**
   - 문서 정보를 먼저 로드하여 `documentTotalPages`가 설정되도록 보장

### 🟡 개선 (사용자 경험 향상)
4. **PDF URL 유효성 검사 강화**
5. **에러 메시지 개선**
6. **로딩 상태 메시지 명확화**

---

## 🎯 결론

**주요 원인** (우선순위 순):

### 🔴 가장 중요한 문제
1. **PDF 청크 생성 시 page 메타데이터가 저장되지 않음** (근본 원인)
   - `scripts/migrate-to-firestore.js`의 `processChunksStreaming` 함수에서 `metadata.page`를 저장하지 않음
   - 결과: 모든 청크의 page가 0 → 페이지 번호 계산 실패

### 🟠 중요한 문제
2. **소스 클릭 시 PDF 파일명이 전달되지 않음**
   - `App.tsx`의 `handleSourceClick`에서 `setPdfFilename`을 호출하지 않음
   - 결과: PDF URL이 빈 문자열 → PDF 로드 실패

3. **상태 업데이트 타이밍 문제**
   - `chunksByPage` useMemo 내부에서 `setMaxPdfPage` 호출 (Side Effect)
   - `documentTotalPages` 설정 전에 `chunksByPage`가 계산될 수 있음

### 🟡 개선 필요 사항
4. **PDF URL 유효성 검사 강화**
5. **에러 메시지 개선**
6. **로딩 상태 명확화**

**해결 우선순위**:
1. ✅ **즉시 수정**: `App.tsx` `handleSourceClick`에 `setPdfFilename` 추가
2. ✅ **빠른 수정**: `SourceViewer.tsx`에서 상태 업데이트 로직 개선
3. ⚠️ **근본 해결**: PDF 처리 스크립트에서 page 메타데이터 저장 (데이터 재생성 필요)

이 문제들을 순차적으로 해결하면 PDF 뷰어가 정상 작동할 것으로 예상됩니다.

