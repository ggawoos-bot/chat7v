/**
 * Firestore 청크 페이지 정보 업데이트 스크립트
 * 기존 청크 데이터는 유지하고, 하이브리드 방식으로 페이지 정보만 재계산하여 업데이트
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  query, 
  getDocs, 
  writeBatch, 
  doc, 
  Timestamp,
  where,
  limit
} from 'firebase/firestore';
import { createRequire } from 'module';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// .env.local 파일 로드
const envLocalPath = path.resolve(__dirname, '..', '.env.local');
if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath });
  console.log('✅ .env.local 파일 로드 완료');
}

dotenv.config();

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

// Firebase 초기화 (migrate-to-firestore.js와 동일한 방식)
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY || "AIzaSyDyx_GGIDteLNZKspL0RqLdNfMA-uLXwq0",
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || process.env.VITE_FIREBASE_AUTH_DOMAIN || "chat7-88761.firebaseapp.com",
  projectId: process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || "chat7-88761",
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || process.env.VITE_FIREBASE_STORAGE_BUCKET || "chat7-88761.firebasestorage.app",
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "1090093126813",
  appId: process.env.FIREBASE_APP_ID || process.env.VITE_FIREBASE_APP_ID || "1:1090093126813:web:3f8872dfe3c4f13c92f074"
};

// Firebase 설정 검증
if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
  console.error('❌ Firebase 설정이 올바르지 않습니다. 환경변수를 확인하세요.');
  process.exit(1);
}

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ✅ PDF.js 로드 (migrate-to-firestore.js와 동일한 로직)
let pdfjsLib = null;
let pdfjsLibLoaded = false;

async function loadPdfJs() {
  if (pdfjsLibLoaded) return pdfjsLib;
  
  try {
    // 다양한 경로 시도 (migrate-to-firestore.js와 동일)
    const possiblePaths = [
      path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.js'),
      path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'build', 'pdf.mjs'),
      path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'build', 'pdf.js'),
      path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'dist', 'pdf.mjs'),
      path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'lib', 'pdf.mjs'),
    ];
    
    for (const pdfjsLibPath of possiblePaths) {
      if (fs.existsSync(pdfjsLibPath)) {
        try {
          // Windows 경로 처리
          const fileUrl = 'file:///' + pdfjsLibPath.replace(/\\/g, '/').replace(/^([A-Z]):/, (match, drive) => `/${drive.toLowerCase()}`);
          pdfjsLib = await import(fileUrl);
          pdfjsLibLoaded = true;
          console.log(`✅ PDF.js 로드 완료: ${path.basename(pdfjsLibPath)}`);
          
          // GlobalThis 설정 (PDF.js가 필요로 함)
          if (typeof globalThis !== 'undefined' && !globalThis.pdfjsLib) {
            globalThis.pdfjsLib = pdfjsLib;
          }
          
          return pdfjsLib;
        } catch (importError) {
          console.warn(`⚠️ 경로 ${pdfjsLibPath}에서 로드 실패:`, importError.message);
          continue;
        }
      }
    }
    
    // 직접 모듈로 import 시도 (최신 버전)
    try {
      pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.js');
      pdfjsLibLoaded = true;
      console.log('✅ PDF.js 모듈 import 성공 (legacy)');
      return pdfjsLib;
    } catch (e1) {
      try {
        pdfjsLib = await import('pdfjs-dist/build/pdf.mjs');
        pdfjsLibLoaded = true;
        console.log('✅ PDF.js 모듈 import 성공 (build/pdf.mjs)');
        return pdfjsLib;
      } catch (e2) {
        console.warn('⚠️ PDF.js를 찾을 수 없습니다. pdf-parse를 사용합니다.');
        pdfjsLibLoaded = true;
        return null;
      }
    }
  } catch (error) {
    console.warn('⚠️ PDF.js 로드 실패, pdf-parse 사용:', error.message);
    pdfjsLibLoaded = true;
    return null;
  }
}

// ✅ PDF 파일 파싱 (migrate-to-firestore.js의 parsePdfFile 함수 재사용)
async function parsePdfFile(pdfPath) {
  try {
    const dataBuffer = fs.readFileSync(pdfPath);
    const loadedPdfJs = await loadPdfJs();
    
    if (loadedPdfJs) {
      try {
        const loadingTask = loadedPdfJs.getDocument({
          data: new Uint8Array(dataBuffer),
          verbosity: 0
        });
        
        const pdf = await loadingTask.promise;
        const numPages = pdf.numPages;
        
        console.log(`📄 PDF.js 로드 완료: ${numPages}페이지`);
        
        const pagesData = [];
        let fullText = '';
        let cumulativeLength = 0;
        
        for (let pageNum = 1; pageNum <= numPages; pageNum++) {
          try {
            const page = await pdf.getPage(pageNum);
            const textContent = await page.getTextContent();
            
            let pageText = '';
            for (let i = 0; i < textContent.items.length; i++) {
              const item = textContent.items[i];
              if (item.str) {
                pageText += item.str;
                if (item.hasEOL) {
                  pageText += '\n';
                } else if (i < textContent.items.length - 1 && 
                          textContent.items[i + 1]?.transform?.[5] && 
                          item.transform?.[5] && 
                          Math.abs(textContent.items[i + 1].transform[5] - item.transform[5]) > 5) {
                  pageText += '\n';
                }
              }
            }
            
            // 논리적 페이지 번호 추출 (간단한 버전)
            const logicalPageNumber = extractLogicalPageNumberSimple(pageText, pageNum);
            
            const pageStart = cumulativeLength;
            const pageEnd = cumulativeLength + pageText.length;
            
            pagesData.push({
              pageNumber: pageNum,
              logicalPageNumber: logicalPageNumber,
              text: pageText,
              startPosition: pageStart,
              endPosition: pageEnd
            });
            
            fullText += pageText;
            cumulativeLength += pageText.length;
            
            if (pageNum % 10 === 0 || pageNum === 1 || pageNum === numPages) {
              console.log(`  ✓ 페이지 ${pageNum}/${numPages} 파싱 완료 (${pageText.length.toLocaleString()}자)`);
            }
          } catch (pageError) {
            console.warn(`  ⚠️ 페이지 ${pageNum} 파싱 실패:`, pageError.message);
            pagesData.push({
              pageNumber: pageNum,
              logicalPageNumber: pageNum,
              text: '',
              startPosition: cumulativeLength,
              endPosition: cumulativeLength
            });
          }
        }
        
        return {
          text: fullText,
          pages: numPages,
          pagesData: pagesData,
          info: {}
        };
      } catch (pdfjsError) {
        console.warn('⚠️ PDF.js 파싱 실패, pdf-parse로 폴백:', pdfjsError.message);
      }
    }
    
    // 폴백: pdf-parse 사용
    const PDFParse = pdfParse.PDFParse || pdfParse;
    const instance = new PDFParse({ data: dataBuffer });
    const data = await instance.getText();
    
    const numPages = data.total || 1;
    const totalLength = data.text.length;
    const avgPageLength = totalLength / numPages;
    
    const pagesData = [];
    for (let i = 1; i <= numPages; i++) {
      const pageStart = Math.floor((i - 1) * avgPageLength);
      const pageEnd = Math.floor(i * avgPageLength);
      const pageText = data.text.slice(pageStart, pageEnd);
      
      pagesData.push({
        pageNumber: i,
        logicalPageNumber: i,
        text: pageText,
        startPosition: pageStart,
        endPosition: pageEnd
      });
    }
    
    return {
      text: data.text,
      pages: numPages,
      pagesData: pagesData,
      info: {}
    };
  } catch (error) {
    console.error(`❌ PDF 파싱 실패: ${pdfPath}`, error);
    throw error;
  }
}

// 간단한 논리적 페이지 번호 추출 (기본 패턴만)
function extractLogicalPageNumberSimple(pageText, pageIndex) {
  const lines = pageText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  const bottomLines = lines.slice(-5);
  
  for (let i = bottomLines.length - 1; i >= 0; i--) {
    const line = bottomLines[i];
    const patterns = [
      /^(\d+)$/,
      /^페이지\s*(\d+)$/i,
      /^Page\s*(\d+)$/i,
      /^(\d+)\s*\/\s*\d+$/,
    ];
    
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match && match[1]) {
        const pageNum = parseInt(match[1], 10);
        if (pageNum >= 1 && pageNum <= 999) {
          return pageNum;
        }
      }
    }
  }
  
  return pageIndex;
}

// ✅ 텍스트 정규화 함수 (매칭용)
function normalizeTextForMatching(text) {
  if (!text) return '';
  return text
    .replace(/\s+/g, ' ')
    .replace(/[\n\r\t]/g, ' ')
    .replace(/[^\w가-힣\s:;]/g, '')
    .toLowerCase()
    .trim();
}

// ✅ 하이브리드 페이지 번호 계산 함수 (migrate-to-firestore.js와 동일)
function getPageInfoForChunkHybrid(chunkStartPos, chunkEndPos, pagesData, chunkContent = null) {
  if (!pagesData || pagesData.length === 0) {
    return { pageIndex: 1, logicalPageNumber: 1 };
  }
  
  // 1단계: 위치 기반으로 후보 페이지 찾기
  const candidatePages = [];
  for (let i = 0; i < pagesData.length; i++) {
    const page = pagesData[i];
    if (chunkStartPos < page.endPosition && chunkEndPos > page.startPosition) {
      candidatePages.push(page);
    }
  }
  
  if (candidatePages.length === 0) {
    const lastPage = pagesData[pagesData.length - 1];
    return {
      pageIndex: lastPage?.pageNumber || 1,
      logicalPageNumber: lastPage?.logicalPageNumber || lastPage?.pageNumber || 1
    };
  }
  
  // 2단계: 텍스트 매칭으로 가장 정확한 페이지 선택
  if (chunkContent && chunkContent.length >= 15) {
    const normalizedChunk = normalizeTextForMatching(chunkContent);
    let bestPage = candidatePages[0];
    let bestScore = 0;
    
    for (const page of candidatePages) {
      const normalizedPageText = normalizeTextForMatching(page.text);
      let score = 0;
      
      // 전체 포함 여부
      if (normalizedPageText.includes(normalizedChunk)) {
        score += 100;
      } else {
        // 부분 매칭
        const minMatchLength = 50;
        if (normalizedChunk.length >= minMatchLength) {
          const chunkKeyPart = normalizedChunk.substring(0, Math.min(100, normalizedChunk.length));
          if (normalizedPageText.includes(chunkKeyPart)) {
            score += 50;
          }
        }
      }
      
      // 오버랩 비율 추가 점수
      const overlapStart = Math.max(chunkStartPos, page.startPosition);
      const overlapEnd = Math.min(chunkEndPos, page.endPosition);
      const overlap = Math.max(0, overlapEnd - overlapStart);
      const chunkLength = chunkEndPos - chunkStartPos;
      const overlapRatio = chunkLength > 0 ? overlap / chunkLength : 0;
      score += overlapRatio * 30;
      
      // 시작 위치 보너스
      if (chunkStartPos >= page.startPosition && chunkStartPos < page.endPosition) {
        score += 10;
      }
      
      if (score > bestScore) {
        bestScore = score;
        bestPage = page;
      }
    }
    
    if (bestScore >= 50) {
      return {
        pageIndex: bestPage.pageNumber,
        logicalPageNumber: bestPage.logicalPageNumber || bestPage.pageNumber
      };
    }
  }
  
  // 3단계: 위치 기반으로 선택
  for (const page of candidatePages) {
    if (chunkStartPos >= page.startPosition && chunkStartPos < page.endPosition) {
      return {
        pageIndex: page.pageNumber,
        logicalPageNumber: page.logicalPageNumber || page.pageNumber
      };
    }
  }
  
  for (const page of candidatePages) {
    if (chunkEndPos > page.startPosition && chunkEndPos <= page.endPosition) {
      return {
        pageIndex: page.pageNumber,
        logicalPageNumber: page.logicalPageNumber || page.pageNumber
      };
    }
  }
  
  // 오버랩 비율로 판단
  let bestPage = candidatePages[0];
  let maxOverlapRatio = 0;
  const chunkLength = chunkEndPos - chunkStartPos;
  
  for (const page of candidatePages) {
    const overlapStart = Math.max(chunkStartPos, page.startPosition);
    const overlapEnd = Math.min(chunkEndPos, page.endPosition);
    const overlap = Math.max(0, overlapEnd - overlapStart);
    const overlapRatio = chunkLength > 0 ? overlap / chunkLength : 0;
    
    if (overlapRatio > maxOverlapRatio) {
      maxOverlapRatio = overlapRatio;
      bestPage = page;
    }
  }
  
  return {
    pageIndex: bestPage.pageNumber,
    logicalPageNumber: bestPage.logicalPageNumber || bestPage.pageNumber
  };
}

// ✅ 문서별로 청크 페이지 정보 업데이트
async function updateChunkPagesForDocument(documentId, filename, pdfPath) {
  try {
    console.log(`\n📄 문서 처리 시작: ${filename}`);
    
    // 1. PDF 파싱
    console.log(`  [1/3] PDF 파싱 중...`);
    const pdfData = await parsePdfFile(pdfPath);
    console.log(`  ✅ PDF 파싱 완료: ${pdfData.pages}페이지, ${pdfData.pagesData.length}개 페이지 데이터`);
    
    // 2. 해당 문서의 모든 청크 가져오기
    console.log(`  [2/3] Firestore에서 청크 가져오는 중...`);
    const chunksQuery = query(
      collection(db, 'pdf_chunks'),
      where('documentId', '==', documentId)
    );
    const chunksSnapshot = await getDocs(chunksQuery);
    
    if (chunksSnapshot.empty) {
      console.log(`  ⚠️ 해당 문서의 청크가 없습니다: ${filename}`);
      return { updated: 0, skipped: 0, errors: 0 };
    }
    
    console.log(`  ✅ ${chunksSnapshot.docs.length}개 청크 발견`);
    
    // 3. 각 청크의 페이지 정보 재계산 및 업데이트
    console.log(`  [3/3] 페이지 정보 업데이트 중...`);
    let batch = writeBatch(db); // ✅ let으로 변경 (재할당 가능)
    const batchSize = 100; // Firestore 배치 제한
    let updateCount = 0;
    let skipCount = 0;
    let errorCount = 0;
    let batchCount = 0;
    
    for (const chunkDoc of chunksSnapshot.docs) {
      try {
        const chunkData = chunkDoc.data();
        const chunkContent = chunkData.content || '';
        const chunkStartPos = chunkData.metadata?.startPos || 0;
        const chunkEndPos = chunkData.metadata?.endPos || chunkContent.length;
        
        // 하이브리드 방식으로 페이지 정보 재계산
        const newPageInfo = getPageInfoForChunkHybrid(
          chunkStartPos,
          chunkEndPos,
          pdfData.pagesData,
          chunkContent
        );
        
        // 기존 페이지 정보
        const oldPageIndex = chunkData.metadata?.pageIndex || chunkData.metadata?.page;
        const oldLogicalPageNumber = chunkData.metadata?.logicalPageNumber || oldPageIndex;
        
        // 페이지 정보가 변경된 경우에만 업데이트
        if (oldPageIndex !== newPageInfo.pageIndex || 
            oldLogicalPageNumber !== newPageInfo.logicalPageNumber) {
          batch.update(chunkDoc.ref, {
            'metadata.page': newPageInfo.pageIndex,
            'metadata.pageIndex': newPageInfo.pageIndex,
            'metadata.logicalPageNumber': newPageInfo.logicalPageNumber,
            'updatedAt': Timestamp.now()
          });
          
          updateCount++;
          batchCount++;
          
          // 배치 크기에 도달하면 커밋하고 새 배치 생성
          if (batchCount >= batchSize) {
            await batch.commit();
            console.log(`    ✓ 배치 커밋: ${updateCount}개 업데이트 (${skipCount}개 건너뜀)`);
            batchCount = 0;
            batch = writeBatch(db); // ✅ 새 배치 생성 (중요!)
          }
        } else {
          skipCount++;
        }
      } catch (error) {
        console.error(`    ❌ 청크 ${chunkDoc.id} 업데이트 실패:`, error.message);
        errorCount++;
      }
    }
    
    // 남은 배치 커밋
    if (batchCount > 0) {
      await batch.commit();
      console.log(`    ✓ 최종 배치 커밋: ${batchCount}개 업데이트`);
    }
    
    console.log(`  ✅ 문서 처리 완료: ${updateCount}개 업데이트, ${skipCount}개 건너뜀, ${errorCount}개 오류`);
    
    return { updated: updateCount, skipped: skipCount, errors: errorCount };
  } catch (error) {
    console.error(`❌ 문서 처리 실패: ${filename}`, error);
    throw error;
  }
}

// ✅ 메인 함수: 모든 문서의 청크 페이지 정보 업데이트
async function updateAllChunkPages() {
  try {
    console.log('🚀 Firestore 청크 페이지 정보 업데이트 시작...\n');
    
    // 1. 모든 문서 가져오기
    console.log('[1/2] Firestore에서 문서 목록 가져오는 중...');
    const documentsQuery = query(collection(db, 'pdf_documents'));
    const documentsSnapshot = await getDocs(documentsQuery);
    
    if (documentsSnapshot.empty) {
      console.log('⚠️ 문서가 없습니다.');
      return;
    }
    
    const documents = documentsSnapshot.docs;
    console.log(`✅ ${documents.length}개 문서 발견\n`);
    
    // 2. PDF 파일 경로 설정
    const pdfDir = path.resolve(__dirname, '..', 'public', 'pdf');
    
    // 3. 각 문서별로 처리
    let totalUpdated = 0;
    let totalSkipped = 0;
    let totalErrors = 0;
    
    for (let i = 0; i < documents.length; i++) {
      const docData = documents[i].data();
      const documentId = documents[i].id;
      const filename = docData.filename || docData.title;
      const pdfPath = path.join(pdfDir, filename);
      
      if (!fs.existsSync(pdfPath)) {
        console.warn(`⚠️ PDF 파일을 찾을 수 없습니다: ${pdfPath}`);
        continue;
      }
      
      try {
        const result = await updateChunkPagesForDocument(documentId, filename, pdfPath);
        totalUpdated += result.updated;
        totalSkipped += result.skipped;
        totalErrors += result.errors;
      } catch (error) {
        console.error(`❌ 문서 처리 실패: ${filename}`, error);
        totalErrors++;
      }
      
      // 문서 간 딜레이 (API 제한 방지)
      if (i < documents.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    console.log('\n🎉 모든 문서 처리 완료!');
    console.log(`📊 총 결과:`);
    console.log(`  - 업데이트: ${totalUpdated}개`);
    console.log(`  - 건너뜀: ${totalSkipped}개`);
    console.log(`  - 오류: ${totalErrors}개`);
    
  } catch (error) {
    console.error('❌ 업데이트 실패:', error);
    process.exit(1);
  }
}

// ✅ 특정 문서만 업데이트하는 함수
async function updateChunkPagesForSpecificDocument(documentFilename) {
  try {
    console.log(`🚀 특정 문서 청크 페이지 정보 업데이트: ${documentFilename}\n`);
    
    // 문서 찾기
    const documentsQuery = query(
      collection(db, 'pdf_documents'),
      where('filename', '==', documentFilename)
    );
    const documentsSnapshot = await getDocs(documentsQuery);
    
    if (documentsSnapshot.empty) {
      console.log(`⚠️ 문서를 찾을 수 없습니다: ${documentFilename}`);
      return;
    }
    
    const docData = documentsSnapshot.docs[0].data();
    const documentId = documentsSnapshot.docs[0].id;
    const pdfPath = path.join(path.resolve(__dirname, '..', 'public', 'pdf'), documentFilename);
    
    if (!fs.existsSync(pdfPath)) {
      console.error(`❌ PDF 파일을 찾을 수 없습니다: ${pdfPath}`);
      return;
    }
    
    const result = await updateChunkPagesForDocument(documentId, documentFilename, pdfPath);
    
    console.log('\n✅ 업데이트 완료!');
    console.log(`📊 결과:`);
    console.log(`  - 업데이트: ${result.updated}개`);
    console.log(`  - 건너뜀: ${result.skipped}개`);
    console.log(`  - 오류: ${result.errors}개`);
    
  } catch (error) {
    console.error('❌ 업데이트 실패:', error);
    process.exit(1);
  }
}

// 스크립트 실행
const args = process.argv.slice(2);

if (args.length > 0) {
  // 특정 문서만 업데이트
  const filename = args[0];
  updateChunkPagesForSpecificDocument(filename);
} else {
  // 모든 문서 업데이트
  updateAllChunkPages();
}

