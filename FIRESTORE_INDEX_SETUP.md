# Firestore 인덱스 설정 가이드

## 🚨 중요: Firestore 복합 인덱스 생성 필요

현재 시스템에서 Firestore 쿼리가 실패하고 있습니다. 다음 인덱스들을 생성해야 합니다.

## 📋 생성해야 할 인덱스 목록

### 1. pdf_chunks 컬렉션 인덱스

#### 인덱스 1: keywords 배열 검색용
- **컬렉션**: `pdf_chunks`
- **필드**: `keywords` (Array)
- **쿼리 범위**: Collection
- **정렬**: 없음

#### 인덱스 2: documentId + keywords 조합
- **컬렉션**: `pdf_chunks`
- **필드**: `documentId` (Ascending), `keywords` (Array)
- **쿼리 범위**: Collection
- **정렬**: 없음

#### 인덱스 3: documentId 단일 검색
- **컬렉션**: `pdf_chunks`
- **필드**: `documentId` (Ascending)
- **쿼리 범위**: Collection
- **정렬**: 없음

## 🔗 인덱스 생성 방법

1. **Firebase 콘솔 접속**
   ```
   https://console.firebase.google.com/v1/r/project/chat-4c3a7/firestore/indexes
   ```

2. **복합 인덱스 생성**
   - "복합 인덱스 만들기" 클릭
   - 위의 인덱스 목록에 따라 각각 생성

3. **인덱스 생성 완료 대기**
   - 인덱스 생성에는 몇 분에서 몇 시간이 소요될 수 있습니다
   - "사용 가능" 상태가 되면 쿼리가 정상 작동합니다

## ⚠️ 주의사항

- 인덱스 생성 중에는 해당 쿼리가 실패할 수 있습니다
- 모든 인덱스가 생성되기 전까지는 실시간 PDF 파싱으로 폴백됩니다
- 인덱스 생성 완료 후 시스템을 재시작하면 Firestore가 정상 작동합니다

## 🧪 테스트 방법

인덱스 생성 완료 후:

1. 브라우저 개발자 도구 콘솔 확인
2. "Firestore 데이터 로드 완료" 메시지 확인
3. "FirebaseError: The query requires an index" 오류가 사라졌는지 확인

## 📞 문제 해결

인덱스 생성 후에도 문제가 지속되면:

1. Firebase 콘솔에서 인덱스 상태 확인
2. 브라우저 캐시 삭제 후 재시작
3. Firestore 보안 규칙 확인
