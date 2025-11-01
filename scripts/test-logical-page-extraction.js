/**
 * 논리적 페이지 번호 추출 테스트 스크립트
 * 실제 PDF 파일에서 몇 페이지를 샘플링하여 논리적 페이지 번호 추출 테스트
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

// ✅ PDF.js를 서버 사이드에서 사용하기 위한 설정
let pdfjsLib = null;
let pdfjsLibLoaded = false;

async function loadPdfJs() {
  if (pdfjsLibLoaded) return pdfjsLib;
  
  try {
    const pdfjsLibPath = path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.js');
    if (fs.existsSync(pdfjsLibPath)) {
      const fileUrl = 'file:///' + pdfjsLibPath.replace(/\\/g, '/').replace(/^([A-Z]):/, (match, drive) => `/${drive.toLowerCase()}`);
      pdfjsLib = await import(fileUrl);
      pdfjsLibLoaded = true;
      console.log('✅ PDF.js Legacy 빌드 로드 완료');
      return pdfjsLib;
    } else {
      console.warn('⚠️ PDF.js legacy 빌드를 찾을 수 없습니다.');
      pdfjsLibLoaded = true;
      return null;
    }
  } catch (error) {
    console.warn('⚠️ PDF.js 로드 실패:', error.message);
    pdfjsLibLoaded = true;
    return null;
  }
}

// ✅ 논리적 페이지 번호 추출 함수 (migrate-to-firestore.js와 동일)
function extractLogicalPageNumber(pageText, pageNum) {
  // 1. 텍스트를 라인별로 분할 (빈 줄 제거)
  const lines = pageText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  
  if (lines.length === 0) {
    return pageNum; // 폴백: 뷰어 인덱스
  }
  
  // 2. 페이지 하단에서 페이지 번호 찾기 (마지막 5줄에서 검색)
  const bottomLines = lines.slice(-5);
  
  console.log(`  📋 하단 5줄:`);
  bottomLines.forEach((line, idx) => {
    console.log(`    [${idx}] "${line}"`);
  });
  
  // 3. 하단에서 위로 올라가면서 페이지 번호 패턴 찾기
  for (let i = bottomLines.length - 1; i >= 0; i--) {
    const line = bottomLines[i];
    
    // 4. 페이지 번호 패턴들 (우선순위 순)
    const pageNumberPatterns = [
      /^(\d+)$/,                    // "53" (단독 숫자만 있는 줄)
      /^페이지\s*(\d+)$/i,           // "페이지 53" 형태
      /^Page\s*(\d+)$/i,             // "Page 53" 형태
      /^(\d+)\s*\/\s*\d+$/,          // "53/124" 형태 (분수에서 분자만)
      /^(\d+)\s*of\s*\d+$/i,         // "53 of 124" 형태
      /^p\.\s*(\d+)$/i,              // "p.53" 형태
      /^P\.\s*(\d+)$/i,              // "P.53" 형태
      /^[가-힣]*\s*(\d+)\s*[가-힣]*$/ // "제 53 장" 같은 형태
    ];
    
    // 각 패턴을 순서대로 시도
    for (let patternIdx = 0; patternIdx < pageNumberPatterns.length; patternIdx++) {
      const pattern = pageNumberPatterns[patternIdx];
      const match = line.match(pattern);
      if (match && match[1]) {
        const extractedNum = parseInt(match[1], 10);
        // 유효한 페이지 번호인지 확인 (1-999 범위)
        if (extractedNum >= 1 && extractedNum <= 999) {
          console.log(`  ✅ 패턴 ${patternIdx + 1} 매칭: "${line}" → ${extractedNum}`);
          return extractedNum;
        }
      }
    }
  }
  
  // 5. 패턴 매칭 실패 시, 하단 라인에서 숫자만 있는 경우 찾기
  for (let i = bottomLines.length - 1; i >= 0; i--) {
    const line = bottomLines[i];
    // 단순히 숫자로만 구성된 라인인지 확인 (길이 제한)
    if (/^\d{1,3}$/.test(line)) {
      const extractedNum = parseInt(line, 10);
      if (extractedNum >= 1 && extractedNum <= 999) {
        console.log(`  ✅ 단순 숫자 패턴: "${line}" → ${extractedNum}`);
        return extractedNum;
      }
    }
  }
  
  // 6. 폴백: 뷰어 인덱스 사용
  console.log(`  ⚠️ 페이지 번호를 찾지 못함. 뷰어 인덱스(${pageNum}) 사용`);
  return pageNum;
}

// PDF 파일 파싱 및 테스트
async function testPageExtraction(pdfPath, testPages = [10, 20, 30, 50, 65, 100]) {
  try {
    console.log(`\n📄 PDF 파일: ${path.basename(pdfPath)}\n`);
    
    const dataBuffer = fs.readFileSync(pdfPath);
    const loadedPdfJs = await loadPdfJs();
    
    if (!loadedPdfJs) {
      console.error('❌ PDF.js를 로드할 수 없습니다.');
      return;
    }
    
    const loadingTask = loadedPdfJs.getDocument({
      data: new Uint8Array(dataBuffer),
      verbosity: 0
    });
    
    const pdf = await loadingTask.promise;
    const numPages = pdf.numPages;
    
    console.log(`📚 총 페이지 수: ${numPages}\n`);
    console.log(`🧪 테스트할 페이지: ${testPages.join(', ')}\n`);
    console.log('='.repeat(80));
    
    const results = [];
    
    for (const pageNum of testPages) {
      if (pageNum > numPages) {
        console.log(`\n⚠️ 페이지 ${pageNum}는 총 페이지 수(${numPages})를 초과합니다.`);
        continue;
      }
      
      console.log(`\n📄 [페이지 ${pageNum}/${numPages}]`);
      console.log('-'.repeat(80));
      
      try {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        
        // 페이지 텍스트 구성
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
        
        // 논리적 페이지 번호 추출
        const logicalPageNumber = extractLogicalPageNumber(pageText, pageNum);
        
        const result = {
          viewerIndex: pageNum,
          logicalPageNumber: logicalPageNumber,
          textLength: pageText.length,
          matched: logicalPageNumber !== pageNum
        };
        
        results.push(result);
        
        console.log(`\n📊 결과:`);
        console.log(`  뷰어 인덱스: ${result.viewerIndex}`);
        console.log(`  논리적 페이지 번호: ${result.logicalPageNumber}`);
        console.log(`  텍스트 길이: ${result.textLength}자`);
        console.log(`  매칭 여부: ${result.matched ? '✅ 매칭됨' : '⚠️ 뷰어 인덱스와 동일'}`);
        
      } catch (pageError) {
        console.error(`  ❌ 페이지 ${pageNum} 파싱 실패:`, pageError.message);
      }
    }
    
    // 요약
    console.log('\n' + '='.repeat(80));
    console.log('📊 테스트 요약');
    console.log('='.repeat(80));
    console.log(`총 테스트 페이지: ${results.length}개`);
    console.log(`성공적으로 추출된 페이지: ${results.filter(r => r.matched).length}개`);
    console.log(`뷰어 인덱스와 동일한 페이지: ${results.filter(r => !r.matched).length}개`);
    console.log('\n📋 상세 결과:');
    results.forEach(r => {
      const status = r.matched ? '✅' : '⚠️';
      console.log(`  ${status} 페이지 ${r.viewerIndex} → 논리적 페이지 ${r.logicalPageNumber}${r.matched ? '' : ' (동일)'}`);
    });
    
  } catch (error) {
    console.error('❌ 테스트 실패:', error);
    console.error(error.stack);
  }
}

// 메인 실행
async function main() {
  try {
    // PDF 파일 목록 가져오기
    const manifestPath = path.join(__dirname, '..', 'public', 'pdf', 'manifest.json');
    
    if (!fs.existsSync(manifestPath)) {
      console.error('❌ manifest.json 파일을 찾을 수 없습니다.');
      return;
    }
    
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    
    if (manifest.length === 0) {
      console.error('❌ PDF 파일이 없습니다.');
      return;
    }
    
    // 첫 번째 PDF 파일로 테스트
    const pdfFile = manifest[0];
    const pdfPath = path.join(__dirname, '..', 'public', 'pdf', pdfFile);
    
    if (!fs.existsSync(pdfPath)) {
      console.error(`❌ PDF 파일을 찾을 수 없습니다: ${pdfPath}`);
      return;
    }
    
    console.log('🧪 논리적 페이지 번호 추출 테스트 시작');
    console.log('='.repeat(80));
    
    // 여러 페이지 테스트 (처음, 중간, 끝)
    await testPageExtraction(pdfPath, [1, 10, 20, 30, 50, 65, 100]);
    
  } catch (error) {
    console.error('❌ 테스트 중 오류 발생:', error);
    process.exit(1);
  }
}

main();

