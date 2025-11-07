/**
 * PDF 파일을 직접 읽어서 Firestore로 마이그레이션하는 스크립트
 * JSON 파일 의존성 없이 PDF를 직접 처리하여 Firestore에 저장
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, writeBatch, Timestamp, query, where, getDocs, deleteDoc, doc } from 'firebase/firestore';
import { createRequire } from 'module';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// .env.local 파일 로드 (우선순위 높음, 먼저 로드)
const envLocalPath = path.resolve(__dirname, '..', '.env.local');
if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath });
  console.log('✅ .env.local 파일 로드 완료');
}

// .env 파일 로드 (기본값, .env.local이 없을 때 사용)
dotenv.config();

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

// ✅ PDF.js를 서버 사이드에서 사용하기 위한 설정 (Lazy Loading)
// Node.js 환경에서는 legacy 빌드를 사용해야 함
let pdfjsLib = null;
let pdfjsLibLoaded = false;

async function loadPdfJs() {
  if (pdfjsLibLoaded) return pdfjsLib;
  
  try {
    // 다양한 경로 시도 (최신 pdfjs-dist 버전 대응)
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
        pdfjsLibLoaded = true; // 실패했지만 다시 시도하지 않도록
        return null;
      }
    }
  } catch (error) {
    console.warn('⚠️ PDF.js 로드 실패, pdf-parse 사용:', error.message);
    pdfjsLibLoaded = true; // 실패했지만 다시 시도하지 않도록
    return null;
  }
}

// ✅ 동의어 사전 로드
let synonymDictionary = null;
try {
  const dictPath = path.join(__dirname, '..', 'data', 'comprehensive-synonym-dictionary.json');
  if (fs.existsSync(dictPath)) {
    const dictData = fs.readFileSync(dictPath, 'utf8');
    synonymDictionary = JSON.parse(dictData);
    console.log(`✅ 동의어 사전 로드 완료: ${dictData.length}자`);
  } else {
    console.log('⚠️ 동의어 사전 파일을 찾을 수 없습니다. 기본 키워드만 사용합니다.');
  }
} catch (error) {
  console.log(`⚠️ 동의어 사전 로드 실패: ${error.message}. 기본 키워드만 사용합니다.`);
}

// Firebase configuration (환경변수 우선)
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || "AIzaSyDyx_GGIDteLNZKspL0RqLdNfMA-uLXwq0",
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || "chat7-88761.firebaseapp.com",
  projectId: process.env.FIREBASE_PROJECT_ID || "chat7-88761",
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "chat7-88761.firebasestorage.app",
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "1090093126813",
  appId: process.env.FIREBASE_APP_ID || "1:1090093126813:web:3f8872dfe3c4f13c92f074"
};



// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// SSL/TLS 인증서 검증 설정 (개발 환경용)
if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  console.log('⚠️ SSL 인증서 검증이 비활성화되었습니다. (개발 환경 전용)');
}

// GitHub Actions 환경 감지
const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
const forceReprocess = process.env.FORCE_REPROCESS === 'true';

console.log(`🔧 환경 설정:`);
console.log(`  GitHub Actions: ${isGitHubActions}`);
console.log(`  강제 재처리: ${forceReprocess}`);
console.log(`  Node.js 환경: ${process.env.NODE_ENV || 'development'}`);
console.log(`  SSL 검증: ${process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0' ? '비활성화' : '활성화'}`);

// 메모리 사용량 모니터링
function getMemoryUsage() {
  const used = process.memoryUsage();
  return {
    rss: Math.round(used.rss / 1024 / 1024),
    heapTotal: Math.round(used.heapTotal / 1024 / 1024),
    heapUsed: Math.round(used.heapUsed / 1024 / 1024),
    external: Math.round(used.external / 1024 / 1024)
  };
}

// PDF 파일 목록 가져오기
function getPdfFiles() {
  const manifestPath = path.join(__dirname, '..', 'public', 'pdf', 'manifest.json');
  
  if (!fs.existsSync(manifestPath)) {
    throw new Error('manifest.json 파일을 찾을 수 없습니다.');
  }
  
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return manifest;
}

// ✅ PDF 파일 파싱 (PDF.js Legacy 빌드를 사용한 페이지별 파싱)
async function parsePdfFile(pdfPath) {
  try {
    const dataBuffer = fs.readFileSync(pdfPath);
    
    // PDF.js Legacy 빌드를 lazy load 시도
    const loadedPdfJs = await loadPdfJs();
    
    if (loadedPdfJs) {
      try {
        // Legacy 빌드로 PDF 로드
        const loadingTask = loadedPdfJs.getDocument({
          data: new Uint8Array(dataBuffer),
          verbosity: 0
        });
        
        const pdf = await loadingTask.promise;
        const numPages = pdf.numPages;
        
        console.log(`📄 PDF.js 로드 완료: ${numPages}페이지`);
        
        // 페이지별로 텍스트 추출
        const pagesData = [];
        let fullText = '';
        let cumulativeLength = 0;
        
        for (let pageNum = 1; pageNum <= numPages; pageNum++) {
          try {
            const page = await pdf.getPage(pageNum);
            const textContent = await page.getTextContent();
            
            // 페이지 텍스트 구성
            let pageText = '';
            
            for (let i = 0; i < textContent.items.length; i++) {
              const item = textContent.items[i];
              if (item.str) {
                pageText += item.str;
                // 줄바꿈 처리
                if (item.hasEOL) {
                  pageText += '\n';
                } else if (i < textContent.items.length - 1 && 
                          textContent.items[i + 1]?.transform?.[5] && 
                          item.transform?.[5] && 
                          Math.abs(textContent.items[i + 1].transform[5] - item.transform[5]) > 5) {
                  // Y 좌표 차이가 크면 줄바꿈으로 간주
                  pageText += '\n';
                }
              }
            }
            
            // ✅ 논리적 페이지 번호 추출 (개선된 버전 - 컨텍스트 포함)
            // 이전 페이지와 다음 페이지 정보를 컨텍스트로 전달
            const previousPage = pagesData.length > 0 ? pagesData[pagesData.length - 1] : null;
            const nextPageNumber = pageNum < numPages ? pageNum + 1 : null;
            
            const logicalPageNumber = extractLogicalPageNumber(pageText, pageNum, {
              previousPageNum: previousPage?.logicalPageNumber || null,
              nextPageNum: null, // 다음 페이지는 아직 추출 전이므로 null
              totalPages: numPages
            });
            
            // 페이지 데이터 저장
            const pageStart = cumulativeLength;
            const pageEnd = cumulativeLength + pageText.length;
            
            pagesData.push({
              pageNumber: pageNum, // 뷰어 인덱스 (1-based)
              logicalPageNumber: logicalPageNumber, // 논리적 페이지 번호
              text: pageText,
              startPosition: pageStart,
              endPosition: pageEnd
            });
            
            // 이전 페이지들의 다음 페이지 정보 업데이트 (후처리 - 실패한 페이지 재시도)
            if (pagesData.length >= 2 && pagesData[pagesData.length - 2].logicalPageNumber === pagesData[pagesData.length - 2].pageNumber) {
              // 이전 페이지가 추출 실패했으면 재시도 (다음 페이지 정보 활용)
              const prevIndex = pagesData.length - 2;
              const prevPageText = pagesData[prevIndex].text;
              const retryResult = extractLogicalPageNumber(prevPageText, pagesData[prevIndex].pageNumber, {
                previousPageNum: prevIndex > 0 ? pagesData[prevIndex - 1].logicalPageNumber : null,
                nextPageNum: logicalPageNumber !== pageNum ? logicalPageNumber : null,
                totalPages: numPages
              });
              
              if (retryResult !== pagesData[prevIndex].pageNumber) {
                pagesData[prevIndex].logicalPageNumber = retryResult;
                console.log(`  🔄 페이지 ${pagesData[prevIndex].pageNumber} 재추출 성공: ${retryResult}`);
              }
            }
            
            // 연속된 실패 페이지들 일괄 재처리 (매 10페이지마다)
            if (pageNum % 10 === 0 && pagesData.length >= 10) {
              let retryCount = 0;
              for (let i = Math.max(0, pagesData.length - 10); i < pagesData.length - 1; i++) {
                if (pagesData[i].logicalPageNumber === pagesData[i].pageNumber) {
                  // 실패한 페이지 재시도
                  const prevNum = i > 0 ? pagesData[i - 1].logicalPageNumber : null;
                  const nextNum = pagesData[i + 1].logicalPageNumber !== pagesData[i + 1].pageNumber 
                    ? pagesData[i + 1].logicalPageNumber 
                    : null;
                  const retryResult = extractLogicalPageNumber(pagesData[i].text, pagesData[i].pageNumber, {
                    previousPageNum: prevNum,
                    nextPageNum: nextNum,
                    totalPages: numPages
                  });
                  
                  if (retryResult !== pagesData[i].pageNumber) {
                    pagesData[i].logicalPageNumber = retryResult;
                    retryCount++;
                  }
                }
              }
              if (retryCount > 0) {
                console.log(`  🔄 일괄 재추출: ${retryCount}개 페이지 성공`);
              }
            }
            
            fullText += pageText + '\n\n';
            cumulativeLength = pageEnd + 2; // '\n\n' 포함
            
            if (pageNum % 10 === 0 || pageNum === 1 || pageNum === numPages) {
              const successIndicator = logicalPageNumber !== pageNum ? ` (논리적 페이지: ${logicalPageNumber})` : '';
              console.log(`  ✓ 페이지 ${pageNum}/${numPages} 파싱 완료 (${pageText.length.toLocaleString()}자)${successIndicator}`);
            }
          } catch (pageError) {
            console.warn(`  ⚠️ 페이지 ${pageNum} 파싱 실패:`, pageError.message);
            // 빈 페이지로 처리
            pagesData.push({
              pageNumber: pageNum, // 뷰어 인덱스
              logicalPageNumber: pageNum, // 논리적 페이지 번호 (기본값)
              text: '',
              startPosition: cumulativeLength,
              endPosition: cumulativeLength
            });
          }
        }
        
        // 최종 후처리: 실패한 페이지들 재추출
        console.log('🔄 최종 후처리: 실패한 페이지들 재추출 시도...');
        let finalRetryCount = 0;
        for (let i = 0; i < pagesData.length; i++) {
          if (pagesData[i].logicalPageNumber === pagesData[i].pageNumber) {
            const prevNum = i > 0 ? pagesData[i - 1].logicalPageNumber : null;
            const nextNum = i < pagesData.length - 1 && pagesData[i + 1].logicalPageNumber !== pagesData[i + 1].pageNumber
              ? pagesData[i + 1].logicalPageNumber
              : null;
            const retryResult = extractLogicalPageNumber(pagesData[i].text, pagesData[i].pageNumber, {
              previousPageNum: prevNum,
              nextPageNum: nextNum,
              totalPages: numPages
            });
            
            if (retryResult !== pagesData[i].pageNumber) {
              pagesData[i].logicalPageNumber = retryResult;
              finalRetryCount++;
            }
          }
        }
        
        const extractedCount = pagesData.filter(p => p.logicalPageNumber !== p.pageNumber).length;
        const extractionRate = ((extractedCount / numPages) * 100).toFixed(1);
        
        console.log(`✅ PDF 파싱 완료: ${numPages}페이지, 총 ${fullText.length.toLocaleString()}자`);
        console.log(`📊 논리적 페이지 번호 추출 결과: ${extractedCount}/${numPages}개 성공 (${extractionRate}%)`);
        if (finalRetryCount > 0) {
          console.log(`📊 최종 후처리로 ${finalRetryCount}개 페이지 추가 추출 성공`);
        }
        
        return {
          text: fullText,
          pages: numPages,
          pagesData: pagesData,
          info: {}
        };
      } catch (pdfjsError) {
        console.warn('⚠️ PDF.js 파싱 실패, pdf-parse로 폴백:', pdfjsError.message);
        // 폴백: pdf-parse 사용
      }
    }
    
    // 폴백: pdf-parse 사용 (페이지별 정보는 없지만 기본 기능 작동)
    const PDFParse = pdfParse.PDFParse || pdfParse;
    const instance = new PDFParse({ data: dataBuffer });
    const data = await instance.getText();
    
    console.warn('⚠️ pdf-parse 사용 (페이지별 정보는 비율로 추정됨)');
    console.log('📝 논리적 페이지 번호 추출 시도 (텍스트 기반)...');
    
    // pdf-parse는 페이지별 정보를 제공하지 않으므로 비율 계산
    const numPages = data.total || 1;
    const totalLength = data.text.length;
    const avgPageLength = totalLength / numPages;
    
    const pagesData = [];
    for (let i = 1; i <= numPages; i++) {
      const pageStart = Math.floor((i - 1) * avgPageLength);
      const pageEnd = Math.floor(i * avgPageLength);
      const pageText = data.text.slice(pageStart, pageEnd);
      
      // ✅ 논리적 페이지 번호 추출 함수 호출 (개선된 버전 - 컨텍스트 포함)
      const previousPage = pagesData.length > 0 ? pagesData[pagesData.length - 1] : null;
      const logicalPageNumber = extractLogicalPageNumber(pageText, i, {
        previousPageNum: previousPage?.logicalPageNumber || null,
        nextPageNum: null,
        totalPages: numPages
      });
      
      pagesData.push({
        pageNumber: i, // 뷰어 인덱스
        logicalPageNumber: logicalPageNumber, // ✅ 추출된 논리적 페이지 번호
        text: pageText,
        startPosition: pageStart,
        endPosition: pageEnd
      });
      
      // 진행 상황 로그 (처음 10페이지, 매 50페이지, 마지막 페이지)
      if (i <= 10 || i % 50 === 0 || i === numPages) {
        if (logicalPageNumber !== i) {
          console.log(`  ✓ 페이지 ${i}: 논리적 페이지 번호 ${logicalPageNumber} 추출 성공`);
        }
      }
      
      // 연속된 실패 페이지들 일괄 재처리 (매 20페이지마다)
      if (i % 20 === 0 && pagesData.length >= 20) {
        let retryCount = 0;
        for (let j = Math.max(0, pagesData.length - 20); j < pagesData.length - 1; j++) {
          if (pagesData[j].logicalPageNumber === pagesData[j].pageNumber) {
            // 실패한 페이지 재시도
            const prevNum = j > 0 ? pagesData[j - 1].logicalPageNumber : null;
            const nextNum = pagesData[j + 1].logicalPageNumber !== pagesData[j + 1].pageNumber 
              ? pagesData[j + 1].logicalPageNumber 
              : null;
            const retryResult = extractLogicalPageNumber(pagesData[j].text, pagesData[j].pageNumber, {
              previousPageNum: prevNum,
              nextPageNum: nextNum,
              totalPages: numPages
            });
            
            if (retryResult !== pagesData[j].pageNumber) {
              pagesData[j].logicalPageNumber = retryResult;
              retryCount++;
            }
          }
        }
        if (retryCount > 0) {
          console.log(`  🔄 일괄 재추출: ${retryCount}개 페이지 성공`);
        }
      }
    }
    
    // 최종 후처리: 남은 실패 페이지들 일괄 재처리
    console.log('🔄 최종 후처리: 실패한 페이지들 재추출 시도...');
    let finalRetryCount = 0;
    for (let i = 0; i < pagesData.length; i++) {
      if (pagesData[i].logicalPageNumber === pagesData[i].pageNumber) {
        const prevNum = i > 0 ? pagesData[i - 1].logicalPageNumber : null;
        const nextNum = i < pagesData.length - 1 && pagesData[i + 1].logicalPageNumber !== pagesData[i + 1].pageNumber
          ? pagesData[i + 1].logicalPageNumber
          : null;
        const retryResult = extractLogicalPageNumber(pagesData[i].text, pagesData[i].pageNumber, {
          previousPageNum: prevNum,
          nextPageNum: nextNum,
          totalPages: numPages
        });
        
        if (retryResult !== pagesData[i].pageNumber) {
          pagesData[i].logicalPageNumber = retryResult;
          finalRetryCount++;
        }
      }
    }
    
    // 추출 결과 요약
    const extractedCount = pagesData.filter(p => p.logicalPageNumber !== p.pageNumber).length;
    const extractionRate = ((extractedCount / numPages) * 100).toFixed(1);
    console.log(`📊 논리적 페이지 번호 추출 결과: ${extractedCount}/${numPages}개 성공 (${extractionRate}%)`);
    if (finalRetryCount > 0) {
      console.log(`📊 최종 후처리로 ${finalRetryCount}개 페이지 추가 추출 성공`);
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

// 전체 기존 데이터 삭제 함수 (일괄 삭제)
async function clearAllExistingData() {
  try {
    console.log('🗑️ 전체 기존 데이터 삭제 시작...');
    const startTime = Date.now();
    
    // 1. 모든 청크 삭제
    console.log('📦 모든 청크 삭제 중...');
    const allChunksQuery = query(collection(db, 'pdf_chunks'));
    const allChunksSnapshot = await getDocs(allChunksQuery);
    
    if (allChunksSnapshot.empty) {
      console.log('  ✓ 기존 청크 없음');
    } else {
      console.log(`  📦 기존 청크 삭제 중: ${allChunksSnapshot.docs.length}개`);
      
      // WriteBatch로 일괄 삭제 (100개씩, 트랜잭션 크기 제한 방지)
      const batchSize = 100;
      const maxRetries = 3;
      const chunks = allChunksSnapshot.docs;
      let deletedChunks = 0;
      
      for (let i = 0; i < chunks.length; i += batchSize) {
        const batchChunks = chunks.slice(i, i + batchSize);
        let success = false;
        let retryCount = 0;
        
        // 재시도 로직
        while (!success && retryCount < maxRetries) {
          try {
            const batch = writeBatch(db);
            
            batchChunks.forEach(chunkDoc => {
              batch.delete(chunkDoc.ref);
            });
            
            await batch.commit();
            deletedChunks += batchChunks.length;
            success = true;
            
            const progress = ((deletedChunks / chunks.length) * 100).toFixed(1);
            console.log(`  ✓ 청크 삭제 완료: ${deletedChunks}/${chunks.length}개 (${progress}%)`);
            
          } catch (error) {
            retryCount++;
            if (retryCount >= maxRetries) {
              console.error(`  ❌ 배치 삭제 실패 (${i}-${Math.min(i + batchSize, chunks.length)}):`, error.message);
              throw error;
            } else {
              const delay = 1000 * retryCount; // 지수 백오프: 1초, 2초, 3초
              console.warn(`  ⚠️ 삭제 실패, ${delay}ms 후 재시도 (${retryCount}/${maxRetries})...`);
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          }
        }
        
        // 배치 사이에 딜레이 추가 (API 제한 및 트랜잭션 부하 방지)
        if (i + batchSize < chunks.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        
        // 메모리 정리 (매 500개마다)
        if (deletedChunks % 500 === 0 && global.gc) {
          global.gc();
        }
      }
      
      console.log(`  ✅ 청크 삭제 완료: ${deletedChunks}개`);
    }
    
    // 2. 모든 문서 삭제
    console.log('📄 모든 문서 삭제 중...');
    const allDocsQuery = query(collection(db, 'pdf_documents'));
    const allDocsSnapshot = await getDocs(allDocsQuery);
    
    if (allDocsSnapshot.empty) {
      console.log('  ✓ 기존 문서 없음');
    } else {
      console.log(`  📄 기존 문서 삭제 중: ${allDocsSnapshot.docs.length}개`);
      
      // 문서도 배치로 삭제 (안전하게)
      const docBatchSize = 100;
      const maxRetries = 3;
      const documents = allDocsSnapshot.docs;
      let deletedDocs = 0;
      
      for (let i = 0; i < documents.length; i += docBatchSize) {
        const batchDocs = documents.slice(i, i + docBatchSize);
        let success = false;
        let retryCount = 0;
        
        // 재시도 로직
        while (!success && retryCount < maxRetries) {
          try {
            const batch = writeBatch(db);
            
            batchDocs.forEach(docSnapshot => {
              batch.delete(docSnapshot.ref);
            });
            
            await batch.commit();
            deletedDocs += batchDocs.length;
            success = true;
            
            const progress = ((deletedDocs / documents.length) * 100).toFixed(1);
            console.log(`  ✓ 문서 삭제 진행: ${deletedDocs}/${documents.length}개 (${progress}%)`);
            
          } catch (error) {
            retryCount++;
            if (retryCount >= maxRetries) {
              console.error(`  ❌ 문서 배치 삭제 실패 (${i}-${Math.min(i + docBatchSize, documents.length)}):`, error.message);
              throw error;
            } else {
              const delay = 1000 * retryCount;
              console.warn(`  ⚠️ 문서 삭제 실패, ${delay}ms 후 재시도 (${retryCount}/${maxRetries})...`);
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          }
        }
        
        // 배치 사이에 딜레이 추가
        if (i + docBatchSize < documents.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }
      
      console.log(`  ✅ 문서 삭제 완료: ${deletedDocs}개`);
    }
    
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    console.log(`✅ 전체 데이터 삭제 완료 (${duration}초)`);
    return true;
  } catch (error) {
    console.error('❌ 전체 데이터 삭제 실패:', error);
    return false;
  }
}


// 개별 청크를 Firestore에 저장 (사용 안 함 - 배치 저장 사용)
async function saveChunkToFirestore(documentId, filename, chunk, index, position, pagesData = []) {
  try {
    const keywords = extractKeywords(chunk);
    const chunkStartPos = position;
    const chunkEndPos = position + chunk.length;
    
    // ✅ 정확한 페이지 정보 계산 (하이브리드 방식: 위치 + 텍스트 매칭)
    const pageInfo = pagesData.length > 0
      ? getPageInfoForChunk(chunkStartPos, chunkEndPos, pagesData, chunk)
      : { pageIndex: 1, logicalPageNumber: 1 };
    
    const chunkData = {
      documentId: documentId,
      filename: filename,
      content: chunk,
      keywords: keywords,
      metadata: {
        position: index,
        startPos: chunkStartPos,
        endPos: chunkEndPos,
        originalSize: chunk.length,
        source: 'Direct PDF Processing',
        page: pageInfo.pageIndex, // 뷰어 인덱스 (1-based, PDF.js와 호환)
        pageIndex: pageInfo.pageIndex, // 뷰어 인덱스 (명시적)
        logicalPageNumber: pageInfo.logicalPageNumber // 논리적 페이지 번호 (문서에 인쇄된 번호)
      },
      searchableText: chunk.toLowerCase(),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    };
    
    await addDoc(collection(db, 'pdf_chunks'), chunkData);
    return true;
  } catch (error) {
    console.error(`❌ 청크 ${index + 1} 저장 실패:`, error.message);
    return false;
  }
}

// ✅ 텍스트 정규화 함수 (매칭용)
function normalizeTextForMatching(text) {
  if (!text) return '';
  return text
    .replace(/\s+/g, ' ')           // 연속 공백을 하나로
    .replace(/[\n\r\t]/g, ' ')      // 줄바꿈/탭을 공백으로
    .replace(/[^\w가-힣\s:;]/g, '') // 특수문자 제거 (콜론, 세미콜론은 유지)
    .toLowerCase()
    .trim();
}

// ✅ 하이브리드 페이지 번호 계산 함수 (위치 기반 + 텍스트 매칭)
// 위치 기반으로 후보를 필터링하고, 텍스트 매칭으로 가장 정확한 페이지 선택
function getPageInfoForChunk(chunkStartPos, chunkEndPos, pagesData, chunkContent = null) {
  if (!pagesData || pagesData.length === 0) {
    return { pageIndex: 1, logicalPageNumber: 1 };
  }
  
  // ✅ 1단계: 위치 기반으로 후보 페이지 찾기 (빠른 필터링)
  const candidatePages = [];
  for (let i = 0; i < pagesData.length; i++) {
    const page = pagesData[i];
    // 청크가 페이지와 겹치는지 확인 (<= 대신 < 사용으로 경계 처리 개선)
    if (chunkStartPos < page.endPosition && chunkEndPos > page.startPosition) {
      candidatePages.push(page);
    }
  }
  
  if (candidatePages.length === 0) {
    // 후보가 없으면 기존 로직으로 폴백
    const lastPage = pagesData[pagesData.length - 1];
    return {
      pageIndex: lastPage?.pageNumber || 1,
      logicalPageNumber: lastPage?.logicalPageNumber || lastPage?.pageNumber || 1
    };
  }
  
  // ✅ 2단계: 텍스트 매칭으로 가장 정확한 페이지 선택 (하이브리드 방식)
  if (chunkContent && chunkContent.length >= 15) {
    const normalizedChunk = normalizeTextForMatching(chunkContent);
    let bestPage = candidatePages[0];
    let bestScore = 0;
    
    for (const page of candidatePages) {
      const normalizedPageText = normalizeTextForMatching(page.text);
      let score = 0;
      
      // 텍스트 매칭 점수 계산
      // 전체 포함 여부 (가장 높은 점수)
      if (normalizedPageText.includes(normalizedChunk)) {
        score += 100; // 완전 매칭
      } else {
        // 부분 매칭 (최소 50자 이상)
        const minMatchLength = 50;
        if (normalizedChunk.length >= minMatchLength) {
          const chunkKeyPart = normalizedChunk.substring(0, Math.min(100, normalizedChunk.length));
          if (normalizedPageText.includes(chunkKeyPart)) {
            score += 50; // 부분 매칭
          }
        }
      }
      
      // 오버랩 비율 추가 점수 (위치 기반)
      const overlapStart = Math.max(chunkStartPos, page.startPosition);
      const overlapEnd = Math.min(chunkEndPos, page.endPosition);
      const overlap = Math.max(0, overlapEnd - overlapStart);
      const chunkLength = chunkEndPos - chunkStartPos;
      const overlapRatio = chunkLength > 0 ? overlap / chunkLength : 0;
      score += overlapRatio * 30; // 오버랩 비율 점수 (최대 30점)
      
      // 시작 위치가 페이지에 포함되는지 (추가 점수)
      if (chunkStartPos >= page.startPosition && chunkStartPos < page.endPosition) {
        score += 10; // 시작 위치 보너스
      }
      
      if (score > bestScore) {
        bestScore = score;
        bestPage = page;
      }
    }
    
    // 텍스트 매칭으로 충분한 점수를 얻었으면 반환
    if (bestScore >= 50) {
      return {
        pageIndex: bestPage.pageNumber,
        logicalPageNumber: bestPage.logicalPageNumber || bestPage.pageNumber
      };
    }
  }
  
  // ✅ 3단계: 텍스트 매칭 실패 또는 chunkContent가 없는 경우, 위치 기반으로 선택
  // 청크의 시작 위치가 속한 페이지를 우선 찾기
  for (const page of candidatePages) {
    if (chunkStartPos >= page.startPosition && chunkStartPos < page.endPosition) {
      return {
        pageIndex: page.pageNumber,
        logicalPageNumber: page.logicalPageNumber || page.pageNumber
      };
    }
  }
  
  // 시작 위치로 찾지 못한 경우, 끝 위치 기준
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
  
  // 최종 폴백
  return {
    pageIndex: bestPage.pageNumber,
    logicalPageNumber: bestPage.logicalPageNumber || bestPage.pageNumber
  };
}

// 하위 호환성을 위한 함수 (기존 코드 유지)
function getPageNumberForChunk(chunkStartPos, chunkEndPos, pagesData) {
  const pageInfo = getPageInfoForChunk(chunkStartPos, chunkEndPos, pagesData);
  return pageInfo.pageIndex; // 뷰어 인덱스 반환 (기존 동작 유지)
}

// ✅ 문장-페이지 매핑 생성 함수 (방법 2)
function createSentencePageMap(chunkContent, chunkStartPos, chunkEndPos, pagesData) {
  if (!chunkContent || !pagesData || pagesData.length === 0) {
    return { sentences: [], sentencePageMap: {} };
  }
  
  // 1. 청크를 문장으로 분할
  const sentences = chunkContent
    .split(/[.。!！?？\n]/)
    .map(s => s.trim())
    .filter(s => s.length >= 10); // 최소 10자 이상 문장만
  
  if (sentences.length === 0) {
    return { sentences: [], sentencePageMap: {} };
  }
  
  // 2. 각 문장의 페이지 정보 매핑
  const sentencePageMap = {};
  
  sentences.forEach((sentence, index) => {
    // 문장이 청크 내에서의 시작 위치 찾기
    const sentenceStartInChunk = chunkContent.indexOf(sentence);
    if (sentenceStartInChunk < 0) {
      // 정확히 찾지 못한 경우, 부분 매칭 시도
      const normalizedSentence = normalizeTextForMatching(sentence);
      for (let i = 0; i < chunkContent.length - normalizedSentence.length; i++) {
        const chunkPart = normalizeTextForMatching(
          chunkContent.substring(i, i + Math.min(100, chunkContent.length - i))
        );
        if (chunkPart.includes(normalizedSentence.substring(0, Math.min(30, normalizedSentence.length)))) {
          sentenceStartInChunk = i;
          break;
        }
      }
    }
    
    if (sentenceStartInChunk >= 0) {
      // 청크 내 상대 위치를 전체 텍스트의 절대 위치로 변환
      const absolutePosition = chunkStartPos + sentenceStartInChunk;
      
      // 해당 위치가 어느 페이지에 속하는지 찾기
      let foundPage = null;
      for (const page of pagesData) {
        if (absolutePosition >= page.startPosition && absolutePosition < page.endPosition) {
          foundPage = page.pageNumber;
          break;
        }
      }
      
      // 위치 기반으로 찾지 못한 경우, 텍스트 매칭으로 폴백
      if (!foundPage) {
        const normalizedSentence = normalizeTextForMatching(sentence);
        for (const page of pagesData) {
          const normalizedPageText = normalizeTextForMatching(page.text);
          // 문장의 앞부분(최소 20자)이 페이지에 포함되는지 확인
          if (normalizedPageText.includes(normalizedSentence.substring(0, Math.min(20, normalizedSentence.length)))) {
            foundPage = page.pageNumber;
            break;
          }
        }
      }
      
      // 최종 폴백: 청크의 기본 페이지 사용
      if (!foundPage) {
        const pageInfo = getPageInfoForChunk(chunkStartPos, chunkEndPos, pagesData);
        foundPage = pageInfo.pageIndex;
      }
      
      sentencePageMap[index] = foundPage || 1;
    } else {
      // 문장을 찾지 못한 경우, 청크의 기본 페이지 사용
      const pageInfo = getPageInfoForChunk(chunkStartPos, chunkEndPos, pagesData);
      sentencePageMap[index] = pageInfo.pageIndex;
    }
  });
  
  return { sentences, sentencePageMap };
}

// 스트리밍 청크 처리 (WriteBatch 최적화) - 정확한 페이지 번호 사용
async function processChunksStreaming(documentId, filename, text, pagesData = []) {
  const chunkSize = 2000;
  const overlap = 200;
  let position = 0;
  let chunkIndex = 0;
  let successCount = 0;
  let lastPosition = -1; // 무한 루프 방지용
  let stuckCount = 0; // 같은 위치에서 멈춘 횟수
  
  // WriteBatch를 위한 청크 데이터 수집
  const chunkDataList = [];
  const batchSize = 2; // WriteBatch 크기 (메모리 안정성을 위해 2개)
  
  console.log(`📦 스트리밍 청크 처리 시작: ${text.length.toLocaleString()}자`);
  if (pagesData.length > 0) {
    console.log(`📄 총 페이지 수: ${pagesData.length} (정확한 페이지 정보 사용)`);
  }
  console.log(`🔧 배치 크기: ${batchSize}개 (메모리 안정적 모드)`);
  console.log(`💾 초기 메모리: ${JSON.stringify(getMemoryUsage())}MB`);
  
  while (position < text.length) {
    // 무한 루프 방지 체크
    if (position === lastPosition) {
      stuckCount++;
      if (stuckCount > 3) {
        console.error(`❌ 무한 루프 감지! position이 ${position}에서 멈춤. 처리 중단.`);
        break;
      }
    } else {
      stuckCount = 0;
      lastPosition = position;
    }
    
    const end = Math.min(position + chunkSize, text.length);
    let chunk = text.slice(position, end);
    
    // 문장 경계에서 자르기 (개선된 로직)
    if (end < text.length) {
      const lastSentenceEnd = chunk.lastIndexOf('.');
      const lastNewline = chunk.lastIndexOf('\n');
      const lastSpace = chunk.lastIndexOf(' ');
      
      // 더 나은 자르기 지점 찾기
      let cutPoint = Math.max(lastSentenceEnd, lastNewline, lastSpace);
      
      // 최소 50% 이상은 유지
      if (cutPoint > position + chunkSize * 0.5) {
        chunk = chunk.slice(0, cutPoint + 1);
      }
    }
    
    // 청크 데이터 수집
    const keywords = extractKeywords(chunk.trim());
    const chunkStartPos = position;
    const chunkEndPos = position + chunk.length;
    
    // ✅ 정확한 페이지 정보 계산 (하이브리드 방식: 위치 + 텍스트 매칭)
    const pageInfo = pagesData.length > 0
      ? getPageInfoForChunk(chunkStartPos, chunkEndPos, pagesData, chunk.trim())
      : { pageIndex: 1, logicalPageNumber: 1 };
    
    // ✅ 문장-페이지 매핑 생성 (방법 2)
    const { sentences, sentencePageMap } = pagesData.length > 0
      ? createSentencePageMap(chunk.trim(), chunkStartPos, chunkEndPos, pagesData)
      : { sentences: [], sentencePageMap: {} };
    
    chunkDataList.push({
      documentId: documentId,
      filename: filename,
      content: chunk.trim(),
      keywords: keywords,
      metadata: {
        position: chunkIndex,
        startPos: chunkStartPos,
        endPos: chunkEndPos,
        originalSize: chunk.length,
        source: 'Direct PDF Processing',
        page: pageInfo.pageIndex, // 뷰어 인덱스 (1-based, PDF.js와 호환)
        pageIndex: pageInfo.pageIndex, // 뷰어 인덱스 (명시적)
        logicalPageNumber: pageInfo.logicalPageNumber, // 논리적 페이지 번호 (문서에 인쇄된 번호)
        sentences: sentences, // ✅ 문장 배열
        sentencePageMap: sentencePageMap // ✅ 문장 인덱스 -> 페이지 번호 매핑
      },
      searchableText: chunk.trim().toLowerCase(),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    });
    
    // WriteBatch 크기에 도달하면 저장
    if (chunkDataList.length >= batchSize) {
      const saved = await saveChunksBatch(chunkDataList);
      successCount += saved;
      chunkDataList.length = 0; // 배열 초기화
      
      // 메모리 상태 주기적 표시 (매 10개 배치마다)
      if (successCount % 20 === 0) {
        console.log(`  💾 현재 메모리: ${JSON.stringify(getMemoryUsage())}MB`);
      }
    }
    
    // ✅ 올바른 position 업데이트 로직
    if (end >= text.length) {
      // 마지막 청크인 경우 루프 종료
      position = text.length;
    } else {
      // 다음 청크를 위해 오버랩 적용
      position = end - overlap;
      if (position < 0) position = 0;
    }
    chunkIndex++;
    
    // 진행률 표시 (청크 크기도 함께 표시)
    const progress = ((position / text.length) * 100).toFixed(1);
    console.log(`  ✓ 청크 ${chunkIndex} 처리 완료 (${progress}%) - 크기: ${chunk.length}자`);
    
    // 메모리 정리 (매 20개마다 - 2개 배치에 맞춰 조정)
    if (chunkIndex % 20 === 0 && global.gc) {
      global.gc();
      console.log(`  🧹 메모리 정리 완료 (${chunkIndex}개 처리 후)`);
    }
  }
  
  // 남은 청크 데이터 저장
  if (chunkDataList.length > 0) {
    const saved = await saveChunksBatch(chunkDataList);
    successCount += saved;
  }
  
  console.log(`✅ 스트리밍 청크 처리 완료: ${successCount}/${chunkIndex}개 성공`);
  return successCount;
}

// WriteBatch로 청크들을 일괄 저장
async function saveChunksBatch(chunkDataList) {
  try {
    const batch = writeBatch(db);
    
    chunkDataList.forEach(chunkData => {
      const docRef = doc(collection(db, 'pdf_chunks'));
      batch.set(docRef, chunkData);
    });
    
    await batch.commit();
    console.log(`  📦 청크 배치 저장 완료: ${chunkDataList.length}개 (메모리 안정적)`);
    return chunkDataList.length;
  } catch (error) {
    console.error(`❌ 청크 배치 저장 실패:`, error.message);
    return 0;
  }
}

// ✅ 논리적 페이지 번호 추출 함수 (다중 전략 - 실패 시 여러 방법 순차 시도, 재시도 로직 포함, 컨텍스트 기반)
function extractLogicalPageNumber(pageText, pageNum, contextOrMaxRetries = {}) {
  // 컨텍스트 또는 maxRetries 파라미터 처리
  let context = {};
  let maxRetries = 10; // 재시도 횟수 증가
  
  if (typeof contextOrMaxRetries === 'number') {
    maxRetries = contextOrMaxRetries;
  } else if (typeof contextOrMaxRetries === 'object' && contextOrMaxRetries !== null) {
    context = contextOrMaxRetries;
  }
  
  const { previousPageNum = null, nextPageNum = null, totalPages = null } = context;
  
  if (!pageText || pageText.trim().length === 0) {
    // 컨텍스트 기반 추정 시도
    return tryContextualEstimation(pageNum, previousPageNum, nextPageNum);
  }
  
  let attempts = 0;
  let lastResult = null;
  let bestResult = null; // 가장 신뢰도 높은 결과
  
  // 최대 재시도 횟수까지 반복
  while (attempts < maxRetries) {
    attempts++;
    
    // 전략 1: 하단 라인 검색 (5줄 → 10줄 → 15줄 → 20줄 → 30줄 → 50줄 확장)
    for (const bottomLineCount of [5, 10, 15, 20, 30, 50]) {
      const result = tryExtractFromBottomLines(pageText, pageNum, bottomLineCount);
      if (result.success) {
        const patternType = result.patternType || 'unknown';
        if (validatePageNumberWithContext(result.value, pageNum, patternType, previousPageNum, nextPageNum)) {
          console.log(`  ✅ [시도 ${attempts}] 페이지 ${pageNum}: 논리적 페이지 번호 ${result.value} 추출 성공 (전략1-${bottomLineCount}줄)`);
          return result.value;
        }
        if (!bestResult || result.patternType === 'fraction' || result.patternType === 'of-pattern') {
          bestResult = result;
        }
        lastResult = result;
      }
    }
    
    // 전략 2: 전체 텍스트에서 페이지 번호 패턴 검색 (하단 우선)
    const result2 = tryExtractFromFullText(pageText, pageNum);
    if (result2.success) {
      const patternType = result2.patternType || 'unknown';
      if (validatePageNumberWithContext(result2.value, pageNum, patternType, previousPageNum, nextPageNum)) {
        console.log(`  ✅ [시도 ${attempts}] 페이지 ${pageNum}: 논리적 페이지 번호 ${result2.value} 추출 성공 (전략2)`);
        return result2.value;
      }
      if (!bestResult || result2.patternType === 'fraction') {
        bestResult = result2;
      }
      lastResult = result2;
    }
    
    // 전략 3: 중앙 하단 영역 검색 (라인 길이 기반)
    const result3 = tryExtractFromCenterBottom(pageText, pageNum);
    if (result3.success) {
      const patternType = result3.patternType || 'unknown';
      if (validatePageNumberWithContext(result3.value, pageNum, patternType, previousPageNum, nextPageNum)) {
        console.log(`  ✅ [시도 ${attempts}] 페이지 ${pageNum}: 논리적 페이지 번호 ${result3.value} 추출 성공 (전략3)`);
        return result3.value;
      }
      if (!bestResult) {
        bestResult = result3;
      }
      lastResult = result3;
    }
    
    // 전략 4: 분수 패턴 검색 (예: "53/124"에서 53 추출)
    const result4 = tryExtractFromFraction(pageText, pageNum);
    if (result4.success) {
      if (validatePageNumberWithContext(result4.value, pageNum, 'fraction', previousPageNum, nextPageNum)) {
        console.log(`  ✅ [시도 ${attempts}] 페이지 ${pageNum}: 논리적 페이지 번호 ${result4.value} 추출 성공 (전략4-분수)`);
        return result4.value;
      }
      if (!bestResult || bestResult.patternType !== 'fraction') {
        bestResult = result4; // 분수 패턴은 높은 신뢰도
      }
      lastResult = result4;
    }
    
    // 전략 5: 페이지 번호 형식 유사도 검색
    const result5 = tryExtractBySimilarity(pageText, pageNum);
    if (result5.success) {
      if (validatePageNumberWithContext(result5.value, pageNum, 'single-digit', previousPageNum, nextPageNum)) {
        console.log(`  ✅ [시도 ${attempts}] 페이지 ${pageNum}: 논리적 페이지 번호 ${result5.value} 추출 성공 (전략5)`);
        return result5.value;
      }
      if (!bestResult) {
        bestResult = result5;
      }
      lastResult = result5;
    }
    
    // 전략 6: 컨텍스트 기반 추정 (이전/다음 페이지 정보 활용)
    if (previousPageNum !== null || nextPageNum !== null) {
      const estimated = tryContextualEstimation(pageNum, previousPageNum, nextPageNum);
      if (estimated !== pageNum && estimated >= 1 && estimated <= 999) {
        console.log(`  ✅ [시도 ${attempts}] 페이지 ${pageNum}: 논리적 페이지 번호 ${estimated} 추출 성공 (전략6-컨텍스트)`);
        return estimated;
      }
    }
    
    // 마지막 시도에서 가장 좋은 결과 사용 (검증 완화)
    if (attempts >= maxRetries && bestResult) {
      const diff = Math.abs(bestResult.value - pageNum);
      console.log(`  ⚠️ 페이지 ${pageNum}: 모든 검증 실패, 최선 결과 ${bestResult.value} 사용 (차이: ${diff}, 패턴: ${bestResult.patternType || 'unknown'})`);
      return bestResult.value;
    }
  }
  
  // 모든 전략 실패: 컨텍스트 기반 추정 또는 뷰어 인덱스 사용
  const contextualResult = tryContextualEstimation(pageNum, previousPageNum, nextPageNum);
  if (contextualResult !== pageNum) {
    return contextualResult;
  }
  
  if (pageNum % 50 === 0 || pageNum === 1 || pageNum <= 10) {
    console.log(`  ⚠️ 페이지 ${pageNum}에서 논리적 페이지 번호를 찾지 못함. 모든 전략 실패. 뷰어 인덱스(${pageNum}) 사용`);
  }
  return pageNum;
}

// 컨텍스트 기반 추정 함수
function tryContextualEstimation(pageNum, previousPageNum, nextPageNum) {
  // 이전 페이지 번호가 있으면 그것을 기반으로 추정
  if (previousPageNum !== null && previousPageNum !== undefined && previousPageNum !== pageNum) {
    const estimated = previousPageNum + 1;
    if (estimated >= 1 && estimated <= 999) {
      return estimated;
    }
  }
  
  // 다음 페이지 번호가 있으면 그것을 기반으로 추정
  if (nextPageNum !== null && nextPageNum !== undefined && nextPageNum !== pageNum) {
    const estimated = nextPageNum - 1;
    if (estimated >= 1 && estimated <= 999) {
      return estimated;
    }
  }
  
  return pageNum;
}

// 컨텍스트를 고려한 페이지 번호 검증 함수
function validatePageNumberWithContext(extractedNum, pageNum, patternType = 'unknown', previousPageNum = null, nextPageNum = null) {
  if (!extractedNum || extractedNum < 1 || extractedNum > 999) {
    return false;
  }
  
  // 뷰어 인덱스와 동일하면 유효하지 않음
  if (extractedNum === pageNum) {
    return false;
  }
  
  // 컨텍스트 기반 검증
  if (previousPageNum !== null && previousPageNum !== undefined) {
    const diffFromPrev = extractedNum - previousPageNum;
    // 이전 페이지보다 1 증가하는 것이 일반적이지만, ±5 범위는 허용
    if (diffFromPrev < -5 || diffFromPrev > 10) {
      return false;
    }
  }
  
  if (nextPageNum !== null && nextPageNum !== undefined) {
    const diffToNext = nextPageNum - extractedNum;
    // 다음 페이지보다 1 작은 것이 일반적이지만, ±5 범위는 허용
    if (diffToNext < -5 || diffToNext > 10) {
      return false;
    }
  }
  
  // 기본 검증
  return validatePageNumber(extractedNum, pageNum, patternType);
}

// 페이지 번호 검증 함수 (추출된 번호가 합리적인지 확인, 본문 숫자 제외 강화)
function validatePageNumber(extractedNum, pageNum, patternType = 'unknown') {
  if (!extractedNum || extractedNum < 1 || extractedNum > 999) {
    return false;
  }
  
  // 뷰어 인덱스와 동일하면 유효하지 않음
  if (extractedNum === pageNum) {
    return false;
  }
  
  // 차이 계산
  const diff = Math.abs(extractedNum - pageNum);
  
  // 패턴 타입에 따른 검증 기준
  const isHighConfidencePattern = patternType === 'fraction' || patternType === 'of-pattern';
  const maxDiff = isHighConfidencePattern ? 100 : 30;
  
  // 단독 숫자 패턴의 경우 매우 엄격한 검증
  if (patternType === 'single-digit') {
    // 차이 20 이내만 허용 (너무 크면 본문 숫자)
    if (diff > 20) {
      return false;
    }
    
    // 뷰어 인덱스보다 너무 작으면 본문 숫자 (예: 페이지 100에서 1, 2, 3 등)
    // 최소한 뷰어 인덱스의 20% 이상이어야 함
    if (extractedNum < pageNum * 0.2) {
      return false;
    }
    
    // 뷰어 인덱스보다 크면 비정상 (일반적으로 논리적 번호 <= 뷰어 인덱스)
    if (extractedNum > pageNum && diff > 5) {
      return false;
    }
    
    // 추출된 번호가 뷰어 인덱스보다 작으면 허용 (표지/목차 제외 고려)
    return extractedNum < pageNum;
  }
  
  // 일반 패턴 검증
  if (diff > maxDiff) {
    return false;
  }
  
  // 추출된 번호가 뷰어 인덱스보다 크면 비정상 (일반적으로 논리적 번호 <= 뷰어 인덱스)
  if (extractedNum > pageNum && diff > 5) {
    return false;
  }
  
  // 추출된 번호가 뷰어 인덱스보다 작으면 합리적 (표지/목차 제외)
  if (extractedNum < pageNum && diff <= maxDiff) {
    return true;
  }
  
  return false;
}

// 유효한 텍스트만 필터링 (깨진 바이너리 데이터 제거)
function filterValidText(text) {
  if (!text) return '';
  
  // 한글, 영문, 숫자, 기본 기호가 포함된 라인만 유지
  const lines = text.split('\n');
  const validLines = lines.filter(line => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return false;
    
    // 깨진 바이너리 데이터 체크 (특수 문자 비율이 너무 높으면 제외)
    const validChars = trimmed.match(/[가-힣a-zA-Z0-9\s.,;:!?()[\]{}'"\-=+<>/]/g);
    const validRatio = validChars ? validChars.length / trimmed.length : 0;
    
    // 유효 문자 비율이 50% 이상이거나 숫자/영문만 있는 경우 유효
    return validRatio >= 0.5 || /^[\d\s\/ofOf\-]+$/i.test(trimmed);
  });
  
  return validLines.join('\n');
}

// 전략 1: 하단 라인 검색 (개선된 버전 - 본문 숫자 제외 강화)
function tryExtractFromBottomLines(pageText, pageNum, lineCount = 10) {
  // 깨진 텍스트 필터링 (유효한 텍스트만 사용)
  const validText = filterValidText(pageText);
  if (!validText || validText.trim().length === 0) return { success: false };
  
  const lines = validText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  if (lines.length === 0) return { success: false };
  
  // 하단 끝부분만 집중 검색 (마지막 3-5줄 우선, 그 다음 확장)
  const bottomLines = lineCount <= 5 ? lines.slice(-lineCount) : lines.slice(-Math.min(lineCount, 5));
  
  // 페이지 번호 패턴들 (고신뢰도 패턴 우선, 단독 숫자는 최후 수단)
  const pageNumberPatterns = [
    // 1. 분수 패턴 (가장 신뢰도 높음)
    { pattern: /^(\d{1,3})\s*\/\s*\d+$/, type: 'fraction', confidence: 0.98, minLinePosition: 0.95 },  // "53/124"
    { pattern: /(\d{1,3})\s*\/\s*\d+$/, type: 'fraction', confidence: 0.95, minLinePosition: 0.9 },   // "53/124" (줄 끝)
    { pattern: /^(\d{1,3})\s*\/\s*\d+/, type: 'fraction', confidence: 0.9, minLinePosition: 0.85 },   // "53/124" (줄 시작)
    
    // 2. "of" 패턴
    { pattern: /^--\s*(\d{1,3})\s*of\s*\d+\s*--$/i, type: 'of-pattern', confidence: 0.98, minLinePosition: 0.95 },
    { pattern: /^-\s*(\d{1,3})\s*of\s*\d+\s*-$/i, type: 'of-pattern', confidence: 0.95, minLinePosition: 0.9 },
    { pattern: /^\s*(\d{1,3})\s*of\s*\d+\s*$/i, type: 'of-pattern', confidence: 0.92, minLinePosition: 0.9 },
    { pattern: /^(\d{1,3})\s*of\s*\d+$/i, type: 'of-pattern', confidence: 0.9, minLinePosition: 0.85 },
    
    // 3. 페이지 단어 포함 패턴
    { pattern: /^페이지\s*(\d{1,3})$/i, type: 'page-word', confidence: 0.85, minLinePosition: 0.9 },
    { pattern: /^Page\s*(\d{1,3})$/i, type: 'page-word', confidence: 0.85, minLinePosition: 0.9 },
    { pattern: /^p\.\s*(\d{1,3})$/i, type: 'page-word', confidence: 0.8, minLinePosition: 0.85 },
    { pattern: /^P\.\s*(\d{1,3})$/i, type: 'page-word', confidence: 0.8, minLinePosition: 0.85 },
    { pattern: /페이지\s*(\d{1,3})/i, type: 'page-word', confidence: 0.75, minLinePosition: 0.85 },
    { pattern: /(\d{1,3})\s*페이지/i, type: 'page-word', confidence: 0.75, minLinePosition: 0.85 },
    
    // 4. 단독 숫자 (매우 엄격한 조건 - 하단 마지막 2줄만, 짧은 줄만)
    { pattern: /^(\d{1,3})$/, type: 'single-digit', confidence: 0.4, minLinePosition: 0.98, maxLength: 5 },
  ];
  
  // 하단에서 위로 검색 (마지막 줄부터)
  for (let i = bottomLines.length - 1; i >= 0; i--) {
    const line = bottomLines[i];
    const linePosition = (bottomLines.length - 1 - i) / Math.max(1, bottomLines.length - 1); // 0(마지막) ~ 1(처음)
    const lineIndex = lines.length - (bottomLines.length - i); // 전체 라인에서의 위치
    
    for (const patternObj of pageNumberPatterns) {
      // 라인 위치 검증 (페이지 번호는 하단 끝부분에 있음)
      if (linePosition > patternObj.minLinePosition) continue;
      
      // 단독 숫자는 매우 짧은 줄만 허용 (페이지 번호는 보통 1-5자)
      if (patternObj.maxLength && line.length > patternObj.maxLength) continue;
      
      // 단독 숫자는 하단 마지막 2줄만 검색
      if (patternObj.type === 'single-digit' && i > 1) continue;
      
      const match = line.match(patternObj.pattern);
      if (match && match[1]) {
        const extractedNum = parseInt(match[1], 10);
        if (extractedNum >= 1 && extractedNum <= 999 && extractedNum !== pageNum) {
          // 단독 숫자 패턴은 추가 검증 필요
          if (patternObj.type === 'single-digit') {
            // 뷰어 인덱스와 차이가 너무 크면 본문 숫자일 가능성
            const diff = Math.abs(extractedNum - pageNum);
            if (diff > 50 || extractedNum < pageNum * 0.1) {
              continue; // 본문 숫자일 가능성이 높음
            }
            
            // 매우 작은 숫자(1-10)는 신중하게 - 하단 정말 끝부분만
            if (extractedNum <= 10 && i > 0) {
              continue; // 마지막 줄이 아니면 건너뛰기
            }
          }
          
          // 검증 및 반환
          if (validatePageNumber(extractedNum, pageNum, patternObj.type)) {
            return { success: true, value: extractedNum, patternType: patternObj.type, confidence: patternObj.confidence };
          } else if (extractedNum !== pageNum && patternObj.confidence >= 0.85) {
            // 높은 신뢰도 패턴은 검증 완화
            if (patternObj.type === 'fraction' || patternObj.type === 'of-pattern') {
              return { success: true, value: extractedNum, needsValidation: true, patternType: patternObj.type, confidence: patternObj.confidence };
            }
          }
        }
      }
    }
  }
  
  return { success: false };
}

// 전략 2: 전체 텍스트에서 패턴 검색 (하단 우선, 개선된 버전)
function tryExtractFromFullText(pageText, pageNum) {
  const validText = filterValidText(pageText);
  if (!validText || validText.trim().length === 0) return { success: false };
  
  const lines = validText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  if (lines.length === 0) return { success: false };
  
  // 하단 70%에서 검색 (범위 확대)
  const startIdx = Math.floor(lines.length * 0.3);
  const searchLines = lines.slice(startIdx);
  
  const patterns = [
    { pattern: /(\d{1,3})\s*\/\s*\d+/g, type: 'fraction', confidence: 0.9 },          // "53/124"
    { pattern: /(\d{1,3})\s*of\s*\d+/gi, type: 'of-pattern', confidence: 0.9 },      // "53 of 124"
    { pattern: /\b페이지\s*(\d{1,3})\b/gi, type: 'page-word', confidence: 0.8 },     // "페이지 53"
    { pattern: /\bPage\s*(\d{1,3})\b/gi, type: 'page-word', confidence: 0.8 },       // "Page 53"
    { pattern: /\bp\.\s*(\d{1,3})\b/gi, type: 'page-word', confidence: 0.75 },      // "p. 53"
    { pattern: /\b(\d{1,3})\s*페이지\b/gi, type: 'page-word', confidence: 0.75 },  // "53 페이지"
    { pattern: /\b(\d{1,2})\s*-\s*(\d{1,2})\s*\/\s*(\d{1,3})/g, type: 'fraction', confidence: 0.7 }, // "1-2 / 53"
  ];
  
  const candidates = [];
  
  for (const patternObj of patterns) {
    for (let lineIdx = 0; lineIdx < searchLines.length; lineIdx++) {
      const line = searchLines[lineIdx];
      const matches = [...line.matchAll(patternObj.pattern)];
      for (const match of matches) {
        let num = parseInt(match[1], 10);
        // "1-2 / 53" 같은 패턴은 마지막 숫자 사용
        if (match[3]) {
          num = parseInt(match[3], 10);
        }
        if (num >= 1 && num <= 999 && num !== pageNum) {
          const distance = lineIdx; // 하단으로부터의 거리
          candidates.push({ 
            num, 
            line, 
            distance, 
            patternType: patternObj.type,
            confidence: patternObj.confidence
          });
        }
      }
    }
  }
  
  if (candidates.length > 0) {
    // 하단에 가까우면서 신뢰도 높은 숫자 선택
    candidates.sort((a, b) => {
      // 거리 우선, 그 다음 신뢰도
      if (a.distance !== b.distance) return a.distance - b.distance;
      return b.confidence - a.confidence;
    });
    
    const selected = candidates[0];
    if (validatePageNumber(selected.num, pageNum, selected.patternType)) {
      return { success: true, value: selected.num, patternType: selected.patternType, confidence: selected.confidence };
    } else if (selected.confidence >= 0.8) {
      return { success: true, value: selected.num, needsValidation: true, patternType: selected.patternType, confidence: selected.confidence };
    }
  }
  
  return { success: false };
}

// 전략 3: 중앙 하단 영역 검색 (라인 길이 기반)
function tryExtractFromCenterBottom(pageText, pageNum) {
  const lines = pageText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  if (lines.length < 3) return { success: false };
  
  // 하단 30% 라인
  const bottomStart = Math.floor(lines.length * 0.7);
  const bottomLines = lines.slice(bottomStart);
  
  // 페이지 번호 패턴 (전략1과 동일)
  const pageNumberPatterns = [
    /^--\s*(\d{1,3})\s*of\s*\d+\s*--$/i,
    /^-\s*(\d{1,3})\s*of\s*\d+\s*-$/i,
    /^\s*(\d{1,3})\s*of\s*\d+\s*$/i,
    /^(\d{1,3})\s*\/\s*\d+$/,
    /^(\d{1,3})\s*of\s*\d+$/i,
  ];
  
  // 중앙 정렬된 짧은 라인 찾기 (페이지 번호는 보통 짧음)
  const shortLines = bottomLines.filter(line => line.length > 0 && line.length < 30);
  
  for (const line of shortLines.reverse()) {
    for (const pattern of pageNumberPatterns) {
      const match = line.match(pattern);
      if (match && match[1]) {
        const num = parseInt(match[1], 10);
        if (num >= 1 && num <= 999 && num !== pageNum) {
          // 패턴 타입 확인
          const isHighConfidence = /of|of\s*\d+|\/\s*\d+/.test(line);
          const patternType = isHighConfidence ? 'of-pattern' : 'single-digit';
          if (validatePageNumber(num, pageNum, patternType)) {
            console.log(`  📄 [전략3] 페이지 ${pageNum}에서 논리적 페이지 번호 ${num} 발견 (중앙 하단, 라인: "${line}")`);
            return { success: true, value: num, patternType };
          } else {
            return { success: true, value: num, needsValidation: true, patternType };
          }
        }
      }
    }
  }
  
  return { success: false };
}

// 전략 4: 분수 패턴 검색 (예: "53/124", 개선된 버전)
function tryExtractFromFraction(pageText, pageNum) {
  const validText = filterValidText(pageText);
  if (!validText || validText.trim().length === 0) return { success: false };
  
  // 다양한 분수 패턴 시도
  const fractionPatterns = [
    /(\d{1,3})\s*\/\s*(\d{1,3})/g,           // "53/124"
    /(\d{1,3})\s*-\s*(\d{1,3})\s*\/\s*(\d{1,3})/g,  // "1-2 / 124" (마지막 숫자 사용)
    /(\d{1,3})\s*of\s*(\d{1,3})/gi,          // "53 of 124"
  ];
  
  const allMatches = [];
  
  for (const pattern of fractionPatterns) {
    const matches = [...validText.matchAll(pattern)];
    for (const match of matches) {
      let numerator = parseInt(match[1], 10);
      let denominator = parseInt(match[match.length - 1], 10); // 마지막 숫자를 분모로
      
      // "1-2 / 124" 같은 패턴 처리
      if (match[3]) {
        numerator = parseInt(match[3], 10);
      }
      
      if (numerator >= 1 && numerator <= 999 && denominator >= 1 && denominator <= 1000) {
        const matchIndex = match.index || 0;
        const lineIndex = validText.substring(0, matchIndex).split('\n').length - 1;
        const totalLines = validText.split('\n').length;
        const positionRatio = lineIndex / totalLines;
        
        allMatches.push({
          numerator,
          denominator,
          positionRatio,
          lineIndex,
          matchText: match[0]
        });
      }
    }
  }
  
  if (allMatches.length > 0) {
    // 하단에 가까우면서 합리적인 범위의 분수 선택
    allMatches.sort((a, b) => {
      // 위치 우선 (하단 우선)
      if (Math.abs(a.positionRatio - 1.0) !== Math.abs(b.positionRatio - 1.0)) {
        return Math.abs(b.positionRatio - 1.0) - Math.abs(a.positionRatio - 1.0);
      }
      // 분모가 큰 것 우선 (더 정확할 가능성)
      return b.denominator - a.denominator;
    });
    
    const selected = allMatches[0];
    // 분자가 분모보다 작거나 같고, 합리적인 범위인 경우
    if (selected.numerator <= selected.denominator) {
      if (validatePageNumber(selected.numerator, pageNum, 'fraction')) {
        return { success: true, value: selected.numerator, patternType: 'fraction', confidence: 0.95 };
      } else {
        return { success: true, value: selected.numerator, needsValidation: true, patternType: 'fraction', confidence: 0.95 };
      }
    }
  }
  
  return { success: false };
}

// 전략 5: 유사도 기반 검색 (매우 엄격한 조건 - 본문 숫자 제외)
function tryExtractBySimilarity(pageText, pageNum) {
  const validText = filterValidText(pageText);
  if (!validText || validText.trim().length === 0) return { success: false };
  
  const lines = validText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  if (lines.length === 0) return { success: false };
  
  // 하단 마지막 3줄만 검색 (매우 제한적)
  const bottomStart = Math.max(0, lines.length - 3);
  const bottomLines = lines.slice(bottomStart);
  
  const candidates = [];
  
  // 단독 숫자 찾기 (매우 엄격한 조건)
  for (let i = bottomLines.length - 1; i >= 0; i--) {
    const line = bottomLines[i];
    
    // 정확히 숫자만 있는 매우 짧은 라인 (3자 이하만, 마지막 2줄만)
    if (/^\s*\d{1,3}\s*$/.test(line) && line.trim().length <= 3 && i <= 1) {
      const num = parseInt(line.trim(), 10);
      if (num >= 1 && num <= 999 && num !== pageNum) {
        const diff = Math.abs(num - pageNum);
        
        // 뷰어 인덱스와 차이가 너무 크면 본문 숫자 (50 이내만 허용)
        if (diff > 50) continue;
        
        // 매우 작은 숫자(1-10)는 마지막 줄만 허용
        if (num <= 10 && i > 0) continue;
        
        // 뷰어 인덱스보다 너무 작으면 본문 숫자 가능성
        if (num < pageNum * 0.2) continue;
        
        const distance = bottomLines.length - 1 - i;
        candidates.push({ num, distance, line });
      }
    }
  }
  
  if (candidates.length > 0) {
    // 마지막 줄에 가까운 숫자 선택
    candidates.sort((a, b) => a.distance - b.distance);
    const selected = candidates[0];
    
    if (validatePageNumber(selected.num, pageNum, 'single-digit')) {
      return { success: true, value: selected.num, patternType: 'single-digit', confidence: 0.5 };
    }
  }
  
  return { success: false };
}

// ✅ 범용적 키워드 추출: 모든 한글 단어 자동 추출 + 동의어 확장
function extractKeywords(text) {
  const keywords = new Set();
  
  // 1. 모든 한글 단어 자동 추출 (2-10글자)
  const koreanWords = text.match(/[가-힣]{2,10}/g) || [];
  koreanWords.forEach(word => {
    // 일반적인 조사, 보조사 제외
    if (!isCommonWord(word) && word.length >= 2 && word.length <= 10) {
      keywords.add(word);
    }
  });
  
  // 2. 영어 단어 추출 (시설명, 법령명 등)
  const englishWords = text.match(/[A-Z][a-z]+/g) || [];
  englishWords.forEach(word => {
    if (word.length >= 3 && word.length <= 20) {
      keywords.add(word);
    }
  });
  
  // 3. 법령 조항 패턴 (제X조, 제X항 등)
  const lawPatterns = text.match(/제[0-9]+조|제[0-9]+항|제[0-9]+호/g) || [];
  lawPatterns.forEach(pattern => {
    keywords.add(pattern);
  });
  
  // 4. 동의어 사전 확장 (역방향 매핑)
  if (synonymDictionary && typeof synonymDictionary === 'object') {
    // synonymMappings에서 역방향 검색
    if (synonymDictionary.synonymMappings && typeof synonymDictionary.synonymMappings === 'object') {
      Object.keys(synonymDictionary.synonymMappings).forEach(baseKeyword => {
        const synonyms = synonymDictionary.synonymMappings[baseKeyword];
        if (Array.isArray(synonyms)) {
          // 텍스트에 동의어가 있으면 기본 키워드와 동의어 모두 추가
          const matchedSynonyms = synonyms.filter(syn => text.includes(syn));
          if (matchedSynonyms.length > 0) {
            keywords.add(baseKeyword);
            matchedSynonyms.forEach(syn => keywords.add(syn));
          }
        }
      });
    }
    
    // keywords 배열에서도 검색
    if (synonymDictionary.keywords && Array.isArray(synonymDictionary.keywords)) {
      synonymDictionary.keywords.forEach(dictKeyword => {
        if (typeof dictKeyword === 'string' && text.includes(dictKeyword)) {
          keywords.add(dictKeyword);
        }
      });
    }
  }
  
  return Array.from(keywords);
}

// 일반적인 단어 필터
function isCommonWord(word) {
  const commonWords = [
    '은', '는', '이', '가', '을', '를', '의', '과', '와', '에', '로', '에서',
    '및', '또는', '이다', '것', '등', '밖', '까지', '부터', '만', '도',
    '것을', '것이', '것이', '것에', '것을', '것으로', '것에서는',
    '년', '월', '일', '시', '분', '초'
  ];
  return commonWords.includes(word);
}

// 문서 타입 분류
function getDocumentType(filename) {
  const legalKeywords = ['법률', '시행령', '시행규칙', '규정'];
  const guidelineKeywords = ['지침', '가이드라인', '매뉴얼', '안내'];
  
  const isLegal = legalKeywords.some(keyword => filename.includes(keyword));
  const isGuideline = guidelineKeywords.some(keyword => filename.includes(keyword));
  
  if (isLegal) return '법령';
  if (isGuideline) return '지침';
  return '기타';
}

// PDF 문서를 Firestore에 추가
async function addDocumentToFirestore(filename, pdfData, chunks) {
  try {
    const documentData = {
      filename: filename,
      title: filename.replace('.pdf', ''),
      type: getDocumentType(filename),
      totalPages: pdfData.pages || 0,  // undefined 방지
      totalChunks: chunks.length || 0,
      totalSize: pdfData.text ? pdfData.text.length : 0,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      environment: isGitHubActions ? 'github-actions' : 'local'
    };
    
    const docRef = await addDoc(collection(db, 'pdf_documents'), documentData);
    console.log(`✅ 문서 추가 완료: ${filename} (ID: ${docRef.id})`);
    
    return docRef.id;
  } catch (error) {
    console.error(`❌ 문서 추가 실패: ${filename}`, error);
    throw error;
  }
}

// 기존 함수들 제거됨 - 스트리밍 처리로 교체

// 스트리밍 PDF 처리 함수
async function processPdfStreaming(pdfFile, pdfPath, index, totalFiles) {
  try {
    console.log(`\n📄 [${index + 1}/${totalFiles}] 처리 중: ${pdfFile}`);
    console.log(`💾 메모리 사용량: ${JSON.stringify(getMemoryUsage())}MB`);
    
    // PDF 파일 존재 확인
    if (!fs.existsSync(pdfPath)) {
      throw new Error(`PDF 파일을 찾을 수 없습니다: ${pdfPath}`);
    }
    
    // PDF 파싱
    console.log(`[1/3] PDF 파싱 시도: ${pdfFile}`);
    const pdfData = await parsePdfFile(pdfPath);
    console.log(`✔ PDF 파싱 성공: ${pdfData.text.length.toLocaleString()}자`);
    
    // Firestore에 문서 추가 (청크 없이)
    console.log(`[2/3] 문서 메타데이터 저장 중...`);
    const documentId = await addDocumentToFirestore(pdfFile, pdfData, []);
    
    // 스트리밍 청크 처리 (페이지별 데이터 전달)
    console.log(`[3/3] 스트리밍 청크 처리 중...`);
    const addedChunks = await processChunksStreaming(documentId, pdfFile, pdfData.text, pdfData.pagesData || []);
    
    console.log(`[4/4] 메모리 정리 중...`);
    
    // 즉시 메모리 정리
    pdfData.text = null;
    
    if (global.gc) {
      global.gc();
    }
    
    console.log(`✅ ${pdfFile} 처리 완료 (품질: 100)`);
    return { success: true, chunks: addedChunks };
    
  } catch (error) {
    console.error(`❌ ${pdfFile} 처리 실패:`, error.message);
    return { success: false, error: error.message };
  }
}

// 메인 마이그레이션 함수 (스트리밍 처리)
async function migrateToFirestore() {
  try {
    console.log('🚀 Firestore PDF 스트리밍 처리 시작...');
    console.log(`💾 초기 메모리 사용량: ${JSON.stringify(getMemoryUsage())}MB`);
    
    // 🔥 전체 기존 데이터 일괄 삭제 (한 번만 실행)
    console.log('🗑️ 전체 기존 데이터 삭제 중...');
    const clearSuccess = await clearAllExistingData();
    if (!clearSuccess) {
      console.error('❌ 데이터 삭제 실패로 인해 처리 중단');
      return;
    }
    
    // PDF 파일 목록 가져오기
    const pdfFiles = getPdfFiles();
    console.log(`📄 처리할 PDF 파일: ${pdfFiles.length}개`);
    
    let totalDocuments = 0;
    let totalChunks = 0;
    let failedFiles = [];
    
    // 순차적으로 PDF 파일 처리 (메모리 안정성)
    for (let i = 0; i < pdfFiles.length; i++) {
      const pdfFile = pdfFiles[i];
      const pdfPath = path.join(__dirname, '..', 'public', 'pdf', pdfFile);
      
      const result = await processPdfStreaming(pdfFile, pdfPath, i, pdfFiles.length);
      
      if (result.success) {
        totalDocuments++;
        totalChunks += result.chunks;
      } else {
        failedFiles.push({ file: pdfFile, error: result.error });
      }
      
      // 파일 간 메모리 정리
      if (global.gc) {
        global.gc();
      }
      
      // 진행률 표시
      const progress = (((i + 1) / pdfFiles.length) * 100).toFixed(1);
      console.log(`\n📊 전체 진행률: ${progress}% (${i + 1}/${pdfFiles.length})`);
      console.log(`💾 현재 메모리: ${JSON.stringify(getMemoryUsage())}MB`);
    }
    
    const endTime = Date.now();
    const duration = ((endTime - Date.now()) / 1000).toFixed(2);
    
    console.log('\n🎉 Firestore PDF 직접 처리 완료!');
    console.log('=' * 50);
    console.log(`📊 처리 결과:`);
    console.log(`  - PDF 문서: ${totalDocuments}개`);
    console.log(`  - 청크 데이터: ${totalChunks}개`);
    console.log(`⏱️ 소요 시간: ${duration}초`);
    console.log(`💾 최종 메모리 사용량: ${JSON.stringify(getMemoryUsage())}MB`);
    
    if (isGitHubActions) {
      console.log('\n🎉 GitHub Actions에서 Firestore PDF 직접 처리 완료!');
      console.log('✅ 이제 Firestore에서 데이터를 사용할 수 있습니다!');
    } else {
      console.log('\n✨ 이제 Firestore에서 데이터를 사용할 수 있습니다!');
    }
    
    if (failedFiles.length > 0) {
      console.log(`\n⚠️ 실패한 파일들: ${failedFiles.length}개`);
      failedFiles.forEach(f => console.log(`  - ${f.file}: ${f.error}`));
    }
    
  } catch (error) {
    console.error('\n❌ Firestore PDF 직접 처리 중 오류 발생:', error);
    console.log('\n🔧 문제 해결 방법:');
    console.log('1. Firebase 프로젝트 설정 확인');
    console.log('2. Firestore 규칙 확인 (읽기/쓰기 권한)');
    console.log('3. 네트워크 연결 확인');
    console.log('4. PDF 파일 존재 여부 확인');
    process.exit(1);
  }
}

// 스크립트 실행
migrateToFirestore();