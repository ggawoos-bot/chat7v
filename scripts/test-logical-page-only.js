import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

// ✅ PDF.js 로드 함수 (migrate-to-firestore.js와 동일)
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

// ✅ 좌표 기반 논리적 페이지 번호 추출 (PDF.js 좌표 정보 활용)
function extractLogicalPageNumberWithCoordinates(pageText, pageNum, textItems, pageHeight) {
  if (!textItems || textItems.length === 0 || pageHeight === 0) {
    return { success: false, value: pageNum, method: '좌표 정보 없음' };
  }
  
  // PDF 좌표계 확인: Y 좌표 범위 확인
  const yValues = textItems.map(item => item.y || 0).filter(y => y !== 0);
  if (yValues.length === 0) {
    return { success: false, value: pageNum, method: '유효한 Y 좌표 없음' };
  }
  
  const minY = Math.min(...yValues);
  const maxY = Math.max(...yValues);
  const yRange = maxY - minY;
  
  // PDF.js 좌표계: 일반적으로 하단이 작은 Y 값, 상단이 큰 Y 값
  // 하단 5% 영역만 검색 (페이지 번호는 가장 하단에 있음)
  const bottomThreshold = minY + yRange * 0.05; // 하단 5%
  let bottomTextItems = textItems.filter(item => {
    const y = item.y || 0;
    return y >= minY && y <= bottomThreshold && item.text && item.text.trim().length > 0;
  });
  
  // Y 좌표 기준 정렬 (가장 하단이 먼저 - 작은 Y 값)
  bottomTextItems.sort((a, b) => (a.y || 0) - (b.y || 0));
  
  // 디버깅: 하단 텍스트 항목 확인
  console.log(`  🔍 [디버깅] 페이지 ${pageNum}: Y 범위 ${minY.toFixed(1)} ~ ${maxY.toFixed(1)}, 하단 임계값: ${bottomThreshold.toFixed(1)}, 하단 텍스트 항목 수: ${bottomTextItems.length}`);
  
  // 하단 텍스트를 하나의 문자열로 결합 (연속된 텍스트 아이템 합치기)
  const bottomTextParts = [];
  let currentLine = '';
  let lastY = null;
  
  for (const item of bottomTextItems.slice(0, 50)) { // 하단 50개 항목
    const text = item.text.trim();
    if (!text) continue;
    
    const y = item.y || 0;
    // Y 좌표가 크게 바뀌면 새 줄로 간주 (줄바꿈)
    if (lastY !== null && Math.abs(y - lastY) > 5) {
      if (currentLine.trim().length > 0) {
        bottomTextParts.push(currentLine.trim());
      }
      currentLine = text;
    } else {
      currentLine += (currentLine ? ' ' : '') + text;
    }
    lastY = y;
  }
  if (currentLine.trim().length > 0) {
    bottomTextParts.push(currentLine.trim());
  }
  
  // 하단 라인에서 페이지 번호 패턴 찾기
  const highConfidencePatterns = [
    /(\d{1,3})\s*\/\s*\d+/,           // "53/124"
    /(\d{1,3})\s*of\s*\d+/i,          // "53 of 124"
  ];
  
  const mediumConfidencePatterns = [
    /페이지\s*(\d{1,3})/i,
    /Page\s*(\d{1,3})/i,
  ];
  
  // 높은 신뢰도 패턴 검색 (하단에서 위로)
  for (let i = bottomTextParts.length - 1; i >= 0; i--) {
    const line = bottomTextParts[i];
    
    for (const pattern of highConfidencePatterns) {
      const match = line.match(pattern);
      if (match && match[1]) {
        const num = parseInt(match[1], 10);
        if (num >= 1 && num <= 999 && num !== pageNum) {
          const diff = Math.abs(num - pageNum);
          if (diff <= 50 || (num < pageNum && diff <= 100)) {
            return { 
              success: true, 
              value: num, 
              matchedLine: line, 
              method: '좌표 기반 추출 (하단 분수 패턴)',
              patternType: 'fraction'
            };
          }
        }
      }
    }
  }
  
  // 중간 신뢰도 패턴 검색
  for (let i = bottomTextParts.length - 1; i >= 0; i--) {
    const line = bottomTextParts[i];
    
    for (const pattern of mediumConfidencePatterns) {
      const match = line.match(pattern);
      if (match && match[1]) {
        const num = parseInt(match[1], 10);
        if (num >= 1 && num <= 999 && num !== pageNum) {
          const diff = Math.abs(num - pageNum);
          if (diff <= 30 || (num < pageNum && diff <= 50)) {
            return { 
              success: true, 
              value: num, 
              matchedLine: line, 
              method: '좌표 기반 추출 (페이지 단어)',
              patternType: 'page-word'
            };
          }
        }
      }
    }
  }
  
  // 하단 중앙 영역의 단독 숫자 검색 (매우 엄격)
  // X 좌표 기준으로 중앙 근처만 검색
  if (bottomTextItems.length > 0) {
    const xValues = bottomTextItems.map(item => item.x || 0).filter(x => x !== 0);
    if (xValues.length > 0) {
      const minX = Math.min(...xValues);
      const maxX = Math.max(...xValues);
      const centerX = (minX + maxX) / 2;
      const xRange = maxX - minX;
      
      const bottomCenterItems = bottomTextItems.filter(item => {
        const x = item.x || 0;
        return Math.abs(x - centerX) < xRange * 0.3; // 중앙 ±30% 범위
      });
      
      // 가장 하단에 있는 항목부터 (작은 Y 값)
      bottomCenterItems.sort((a, b) => (a.y || 0) - (b.y || 0));
      
      for (const item of bottomCenterItems.slice(0, 10)) {
        const text = item.text.trim();
        // 단독 숫자만 (3자 이하)
        if (/^\s*\d{1,3}\s*$/.test(text) && text.length <= 3) {
          const num = parseInt(text, 10);
          if (num >= 1 && num <= 999 && num !== pageNum) {
            const diff = Math.abs(num - pageNum);
            // 매우 엄격: 차이가 15 이내이고, 추출된 번호가 뷰어 인덱스보다 작아야 함
            if (diff <= 15 && num < pageNum) {
              return { 
                success: true, 
                value: num, 
                matchedLine: text, 
                method: '좌표 기반 추출 (하단 중앙 단독 숫자)',
                patternType: 'single-digit'
              };
            }
          }
        }
      }
    }
  }
  
  return { success: false, value: pageNum, method: '좌표 기반 추출 실패' };
}

// ✅ 논리적 페이지 번호 추출 함수 (migrate-to-firestore.js와 동일 - 다중 전략)
function extractLogicalPageNumber(pageText, pageNum) {
  if (!pageText || pageText.trim().length === 0) {
    return { success: false, value: pageNum, method: '빈 텍스트' };
  }
  
  // 전략 1: 하단 라인 검색 (5줄 → 10줄 → 15줄 확장)
  for (const bottomLineCount of [5, 10, 15]) {
    const result = tryExtractFromBottomLines(pageText, pageNum, bottomLineCount);
    if (result.success && validatePageNumber(result.value, pageNum, result.patternType || 'unknown')) {
      return { ...result, method: `[전략1-${bottomLineCount}줄] ${result.method}` };
    }
    if (result.success) {
      return { ...result, method: `[전략1-${bottomLineCount}줄] ${result.method} (검증 실패, 차이: ${Math.abs(result.value - pageNum)})` };
    }
  }
  
  // 전략 2: 전체 텍스트에서 페이지 번호 패턴 검색 (하단 우선)
  const result2 = tryExtractFromFullText(pageText, pageNum);
  if (result2.success && validatePageNumber(result2.value, pageNum, result2.patternType || 'unknown')) {
    return { ...result2, method: `[전략2] ${result2.method}` };
  }
  if (result2.success) {
    return { ...result2, method: `[전략2] ${result2.method} (검증 실패)` };
  }
  
  // 전략 3: 중앙 하단 영역 검색 (라인 길이 기반)
  const result3 = tryExtractFromCenterBottom(pageText, pageNum);
  if (result3.success && validatePageNumber(result3.value, pageNum, result3.patternType || 'unknown')) {
    return { ...result3, method: `[전략3] ${result3.method}` };
  }
  if (result3.success) {
    return { ...result3, method: `[전략3] ${result3.method} (검증 실패)` };
  }
  
  // 전략 4: 연속된 숫자 패턴 검색 (예: "53/124"에서 53 추출)
  const result4 = tryExtractFromFraction(pageText, pageNum);
  if (result4.success && validatePageNumber(result4.value, pageNum, 'fraction')) {
    return { ...result4, method: `[전략4] ${result4.method}` };
  }
  if (result4.success) {
    return { ...result4, method: `[전략4] ${result4.method} (검증 실패)` };
  }
  
  // 전략 5: 페이지 번호 형식 유사도 검색
  const result5 = tryExtractBySimilarity(pageText, pageNum);
  if (result5.success && validatePageNumber(result5.value, pageNum, 'single-digit')) {
    return { ...result5, method: `[전략5] ${result5.method}` };
  }
  if (result5.success) {
    return { ...result5, method: `[전략5] ${result5.method} (검증 실패)` };
  }
  
  // 모든 전략 실패
  const lines = pageText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  const bottomLines = lines.slice(-5);
  return {
    success: false,
    value: pageNum,
    method: '모든 전략 실패',
    matchedLine: null,
    pageNum: pageNum,
    bottomLines: bottomLines
  };
}

// 페이지 번호 검증 함수 (본문 숫자 제외 강화)
function validatePageNumber(extractedNum, pageNum, patternType = 'unknown') {
  if (!extractedNum || extractedNum < 1 || extractedNum > 999) {
    return false;
  }
  
  if (extractedNum === pageNum) {
    return false;
  }
  
  const diff = Math.abs(extractedNum - pageNum);
  
  const isHighConfidencePattern = patternType === 'fraction' || patternType === 'of-pattern';
  const maxDiff = isHighConfidencePattern ? 100 : 30;
  
  // 단독 숫자 패턴의 경우 매우 엄격한 검증
  if (patternType === 'single-digit') {
    // 차이 20 이내만 허용
    if (diff > 20) {
      return false;
    }
    
    // 뷰어 인덱스보다 너무 작으면 본문 숫자
    if (extractedNum < pageNum * 0.2) {
      return false;
    }
    
    // 뷰어 인덱스보다 크면 비정상
    if (extractedNum > pageNum && diff > 5) {
      return false;
    }
    
    return extractedNum < pageNum;
  }
  
  if (diff > maxDiff) {
    return false;
  }
  
  if (extractedNum > pageNum && diff > 5) {
    return false;
  }
  
  if (extractedNum < pageNum && diff <= maxDiff) {
    return true;
  }
  
  return false;
}

// 전략 1: 하단 라인 검색 (개선: 단독 숫자는 최후의 수단)
function tryExtractFromBottomLines(pageText, pageNum, lineCount = 10) {
  const lines = pageText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  if (lines.length === 0) return { success: false };
  
  const bottomLines = lines.slice(-lineCount);
  
  // 우선순위별 패턴 (높은 신뢰도 패턴 먼저)
  const highConfidencePatterns = [
    { pattern: /^--\s*(\d{1,3})\s*of\s*\d+\s*--$/i, type: 'of-pattern', name: 'of-pattern (하이픈)' },
    { pattern: /^-\s*(\d{1,3})\s*of\s*\d+\s*-$/i, type: 'of-pattern', name: 'of-pattern' },
    { pattern: /^\s*(\d{1,3})\s*of\s*\d+\s*$/i, type: 'of-pattern', name: 'of-pattern (공백)' },
    { pattern: /^(\d{1,3})\s*\/\s*\d+$/, type: 'fraction', name: '분수 (시작)' },
    { pattern: /^(\d{1,3})\s*\/\s*\d+\s*$/, type: 'fraction', name: '분수 (공백)' },
    { pattern: /(\d{1,3})\s*\/\s*\d+/, type: 'fraction', name: '분수 (임의 위치)' }, // 중간에도 있을 수 있음
  ];
  
  const mediumConfidencePatterns = [
    { pattern: /^페이지\s*(\d{1,3})$/i, type: 'page-word', name: '페이지 (시작)' },
    { pattern: /^Page\s*(\d{1,3})$/i, type: 'page-word', name: 'Page (시작)' },
    { pattern: /^p\.\s*(\d{1,3})$/i, type: 'page-word', name: 'p. (시작)' },
    { pattern: /^P\.\s*(\d{1,3})$/i, type: 'page-word', name: 'P. (시작)' },
    { pattern: /\b페이지\s*(\d{1,3})\b/i, type: 'page-word', name: '페이지 (단어)' },
    { pattern: /\b(\d{1,3})\s*페이지\b/i, type: 'page-word', name: '숫자 페이지' },
    { pattern: /\bPage\s*(\d{1,3})\b/i, type: 'page-word', name: 'Page (단어)' },
  ];
  
  // 단독 숫자는 최후의 수단 (매우 낮은 신뢰도)
  const lowConfidencePatterns = [
    { pattern: /^\s*(\d{1,3})\s*$/, type: 'single-digit', name: '단독 숫자 (완전 매칭)' },
  ];
  
  // 하단에서 위로 검색 (가장 마지막 줄 우선)
  // 1단계: 높은 신뢰도 패턴 검색 (마지막 3줄만)
  const last3Lines = bottomLines.slice(-3);
  for (let i = last3Lines.length - 1; i >= 0; i--) {
    const line = last3Lines[i];
    for (const patternObj of highConfidencePatterns) {
      const match = line.match(patternObj.pattern);
      if (match && match[1]) {
        const extractedNum = parseInt(match[1], 10);
        if (extractedNum >= 1 && extractedNum <= 999 && extractedNum !== pageNum) {
          // 차이 검증: 논리적 페이지 번호는 보통 뷰어 인덱스보다 작거나 비슷함
          const diff = Math.abs(extractedNum - pageNum);
          if (diff <= 50 || (extractedNum < pageNum && diff <= 100)) {
            return { 
              success: true, 
              value: extractedNum, 
              matchedLine: line, 
              method: `하단 라인 검색 (${patternObj.name})`,
              patternType: patternObj.type
            };
          }
        }
      }
    }
  }
  
  // 2단계: 중간 신뢰도 패턴 검색 (마지막 5줄)
  const last5Lines = bottomLines.slice(-5);
  for (let i = last5Lines.length - 1; i >= 0; i--) {
    const line = last5Lines[i];
    for (const patternObj of mediumConfidencePatterns) {
      const match = line.match(patternObj.pattern);
      if (match && match[1]) {
        const extractedNum = parseInt(match[1], 10);
        if (extractedNum >= 1 && extractedNum <= 999 && extractedNum !== pageNum) {
          const diff = Math.abs(extractedNum - pageNum);
          // 중간 신뢰도는 더 엄격한 검증
          if (diff <= 30 || (extractedNum < pageNum && diff <= 50)) {
            return { 
              success: true, 
              value: extractedNum, 
              matchedLine: line, 
              method: `하단 라인 검색 (${patternObj.name})`,
              patternType: patternObj.type
            };
          }
        }
      }
    }
  }
  
  // 3단계: 단독 숫자 검색 (최후의 수단, 매우 엄격한 검증)
  // 가장 마지막 2줄만 검색하고, 매우 작은 차이만 허용
  const last2Lines = bottomLines.slice(-2);
  for (let i = last2Lines.length - 1; i >= 0; i--) {
    const line = last2Lines[i];
    // 라인이 짧고 숫자만 있는 경우만 (페이지 번호는 보통 짧음)
    if (line.length <= 10) {
      for (const patternObj of lowConfidencePatterns) {
        const match = line.match(patternObj.pattern);
        if (match && match[1]) {
          const extractedNum = parseInt(match[1], 10);
          if (extractedNum >= 1 && extractedNum <= 999 && extractedNum !== pageNum) {
            const diff = Math.abs(extractedNum - pageNum);
            // 단독 숫자는 매우 엄격: 차이가 10 이내이고, 추출된 번호가 뷰어 인덱스보다 작아야 함
            if (diff <= 10 && extractedNum < pageNum) {
              return { 
                success: true, 
                value: extractedNum, 
                matchedLine: line, 
                method: `하단 라인 검색 (${patternObj.name}, 매우 엄격)`,
                patternType: patternObj.type
              };
            }
          }
        }
      }
    }
  }
  
  return { success: false };
}

// 전략 2: 전체 텍스트에서 패턴 검색
function tryExtractFromFullText(pageText, pageNum) {
  const lines = pageText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  if (lines.length === 0) return { success: false };
  
  const startIdx = Math.floor(lines.length * 0.5);
  const searchLines = lines.slice(startIdx);
  
  const patterns = [
    /(\d{1,3})\s*\/\s*\d+/g,
    /(\d{1,3})\s*of\s*\d+/gi,
    /\b페이지\s*(\d{1,3})\b/gi,
    /\bPage\s*(\d{1,3})\b/gi,
    /\bp\.\s*(\d{1,3})\b/gi,
  ];
  
  const candidates = [];
  for (const pattern of patterns) {
    for (const line of searchLines) {
      const matches = [...line.matchAll(pattern)];
      for (const match of matches) {
        const num = parseInt(match[1], 10);
        if (num >= 1 && num <= 999 && num !== pageNum) {
          const isHighConfidence = line.includes('/') || line.toLowerCase().includes('of');
          candidates.push({ num, line, distance: searchLines.indexOf(line), patternType: isHighConfidence ? 'fraction' : 'unknown' });
        }
      }
    }
  }
  
  if (candidates.length > 0) {
    candidates.sort((a, b) => a.distance - b.distance);
    const selected = candidates[0];
    return { success: true, value: selected.num, matchedLine: selected.line, method: '전체 텍스트 검색', patternType: selected.patternType };
  }
  
  return { success: false };
}

// 전략 3: 중앙 하단 영역 검색
function tryExtractFromCenterBottom(pageText, pageNum) {
  const lines = pageText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  if (lines.length < 3) return { success: false };
  
  const bottomStart = Math.floor(lines.length * 0.7);
  const bottomLines = lines.slice(bottomStart);
  const shortLines = bottomLines.filter(line => line.length > 0 && line.length < 20);
  
  const pageNumberPatterns = [
    /^--\s*(\d{1,3})\s*of\s*\d+\s*--$/i,
    /^-\s*(\d{1,3})\s*of\s*\d+\s*-$/i,
    /^\s*(\d{1,3})\s*of\s*\d+\s*$/i,
    /^(\d{1,3})\s*\/\s*\d+$/,
    /^(\d{1,3})\s*of\s*\d+$/i,
  ];
  
  for (const line of shortLines.reverse()) {
    for (const pattern of pageNumberPatterns) {
      const match = line.match(pattern);
      if (match && match[1]) {
        const num = parseInt(match[1], 10);
        if (num >= 1 && num <= 999 && num !== pageNum) {
          const isHighConfidence = /of|of\s*\d+|\/\s*\d+/.test(line);
          return { success: true, value: num, matchedLine: line, method: '중앙 하단 검색', patternType: isHighConfidence ? 'of-pattern' : 'single-digit' };
        }
      }
    }
  }
  
  return { success: false };
}

// 전략 4: 분수 패턴 검색
function tryExtractFromFraction(pageText, pageNum) {
  const fractionPattern = /(\d{1,3})\s*[\/\/]\s*(\d{1,3})/g;
  const matches = [...pageText.matchAll(fractionPattern)];
  
  if (matches.length > 0) {
    const textLines = pageText.split('\n');
    const lastMatch = matches[matches.length - 1];
    const matchIndex = lastMatch.index || 0;
    const lineIndex = pageText.substring(0, matchIndex).split('\n').length - 1;
    
    if (lineIndex >= textLines.length * 0.7) {
      const numerator = parseInt(lastMatch[1], 10);
      const denominator = parseInt(lastMatch[2], 10);
      
      if (numerator >= 1 && numerator <= 999 && denominator >= 1 && denominator <= 999) {
        if (numerator <= denominator && denominator <= 1000) {
          return { success: true, value: numerator, matchedLine: `${numerator}/${denominator}`, method: '분수 패턴 검색', patternType: 'fraction' };
        }
      }
    }
  }
  
  return { success: false };
}

// 전략 5: 유사도 기반 검색 (매우 엄격한 조건)
function tryExtractBySimilarity(pageText, pageNum) {
  const lines = pageText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  if (lines.length === 0) return { success: false };
  
  // 하단 마지막 3줄만 검색
  const bottomStart = Math.max(0, lines.length - 3);
  const bottomLines = lines.slice(bottomStart);
  
  for (let i = bottomLines.length - 1; i >= 0; i--) {
    const line = bottomLines[i];
    
    // 매우 짧은 줄만 (3자 이하), 마지막 2줄만
    if (/^\s*\d{1,3}\s*$/.test(line) && line.trim().length <= 3 && i <= 1) {
      const num = parseInt(line.trim(), 10);
      if (num >= 1 && num <= 999 && num !== pageNum) {
        const diff = Math.abs(num - pageNum);
        if (diff > 50 || num < pageNum * 0.2) continue;
        if (num <= 10 && i > 0) continue;
        
        if (validatePageNumber(num, pageNum, 'single-digit')) {
          return { success: true, value: num, matchedLine: line, method: '유사도 검색', patternType: 'single-digit' };
        }
      }
    }
  }
  
  return { success: false };
}


async function testWithPdfParse(pdfPath, testPages = [1, 10, 20, 30, 50, 65, 100, 124]) {
  const dataBuffer = fs.readFileSync(pdfPath);
  let numPages = 0;
  let totalLength = 0;
  let avgPageLength = 0;
  let pagesData = [];
  let loadedPdfJs = null;
  
  try {
    loadedPdfJs = await loadPdfJs();
  } catch (error) {
    console.log('📦 pdf-parse로 파싱 시도...');
  }
  
  if (!loadedPdfJs) {
    try {
      console.log('📦 pdf-parse로 파싱 시도...');
      const PDFParse = pdfParse.PDFParse || pdfParse;
      const instance = new PDFParse({ data: dataBuffer });
      const data = await instance.getText();
      
      numPages = data.total || 1;
      totalLength = data.text.length;
      avgPageLength = totalLength / numPages;
      
      console.log(`✅ pdf-parse 파싱 완료: ${numPages}페이지, 총 ${totalLength.toLocaleString()}자\n`);
    } catch (error) {
      console.error('❌ PDF 파싱 실패:', error.message);
      return;
    }
  } else {
    // PDF.js 사용
    try {
      console.log('📦 PDF.js로 파싱 시도...');
      const loadingTask = loadedPdfJs.getDocument({
        data: new Uint8Array(dataBuffer),
        verbosity: 0
      });
      
      const pdf = await loadingTask.promise;
      numPages = pdf.numPages;
      
      console.log(`✅ PDF.js 로드 완료: ${numPages}페이지\n`);
      
      let fullText = '';
      let cumulativeLength = 0;
      
      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        try {
          const page = await pdf.getPage(pageNum);
          const textContent = await page.getTextContent();
          
          let pageText = '';
          const textItems = []; // 좌표 정보 포함
          
          for (let i = 0; i < textContent.items.length; i++) {
            const item = textContent.items[i];
            if (item.str) {
              pageText += item.str;
              
              // 좌표 정보 저장 (하단 페이지 번호 찾기 위해)
              if (item.transform && item.transform.length >= 4) {
                const x = item.transform[4] || 0; // X 좌표
                const y = item.transform[5] || 0; // Y 좌표
                textItems.push({
                  text: item.str,
                  x: x,
                  y: y,
                  hasEOL: item.hasEOL || false
                });
              } else {
                textItems.push({
                  text: item.str,
                  x: 0,
                  y: 0,
                  hasEOL: item.hasEOL || false
                });
              }
              
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
          
          // 페이지 높이 정보 (하단 위치 확인용)
          const viewport = page.getViewport({ scale: 1.0 });
          const pageHeight = viewport.height;
          
          pagesData.push({
            pageNumber: pageNum,
            text: pageText,
            startPosition: cumulativeLength,
            endPosition: cumulativeLength + pageText.length,
            textItems: textItems, // 좌표 정보 포함
            pageHeight: pageHeight // 페이지 높이
          });
          
          fullText += pageText;
          cumulativeLength += pageText.length;
        } catch (pageError) {
          console.warn(`⚠️ 페이지 ${pageNum} 처리 중 오류:`, pageError.message);
        }
      }
      
      totalLength = fullText.length;
      avgPageLength = totalLength / numPages;
    } catch (error) {
      console.error('❌ PDF.js 파싱 실패:', error.message);
      return;
    }
  }
  
  console.log(`📚 총 페이지 수: ${numPages}`);
  console.log(`📏 총 텍스트 길이: ${totalLength.toLocaleString()}자`);
  console.log(`📏 평균 페이지 길이: ${Math.round(avgPageLength)}자\n`);
  console.log(`🧪 테스트할 페이지: ${testPages.filter(p => p <= numPages).join(', ')}\n`);
  console.log('='.repeat(100));
  
  const pagesToTest = testPages.filter(p => p <= numPages);
  const results = [];
  
  for (const pageNum of pagesToTest) {
    let pageText = '';
    let textItems = [];
    let pageHeight = 0;
    
    if (loadedPdfJs && pagesData.length > 0) {
      const pageData = pagesData.find(p => p.pageNumber === pageNum);
      if (pageData) {
        pageText = pageData.text;
        textItems = pageData.textItems || [];
        pageHeight = pageData.pageHeight || 0;
      }
    } else {
      // pdf-parse 사용 시 textItems와 pageHeight 없음
      
      const pageStart = Math.floor((pageNum - 1) * avgPageLength);
      const pageEnd = Math.floor(pageNum * avgPageLength);
      pageText = fs.readFileSync(pdfPath, 'utf8').slice(pageStart, pageEnd);
      
      if (!pageText || pageText.length === 0) {
        const PDFParse = pdfParse.PDFParse || pdfParse;
        const instance = new PDFParse({ data: dataBuffer });
        const data = await instance.getText();
        const start = Math.floor((pageNum - 1) * avgPageLength);
        const end = Math.floor(pageNum * avgPageLength);
        pageText = data.text.slice(start, end);
      }
    }
    
    // 좌표 기반 페이지 번호 추출 시도
    let result = null;
    if (textItems.length > 0 && pageHeight > 0) {
      result = extractLogicalPageNumberWithCoordinates(pageText, pageNum, textItems, pageHeight);
    }
    
    // 좌표 기반 실패 시 텍스트 기반 추출
    if (!result || !result.success || result.value === pageNum) {
      result = extractLogicalPageNumber(pageText, pageNum);
    }
    results.push({
      viewerIndex: pageNum,
      logicalPageNumber: result.value,
      success: result.success,
      method: result.method,
      matchedLine: result.matchedLine,
      diff: result.value - pageNum
    });
    
    const status = result.success && result.value !== pageNum ? '✅' : '⚠️';
    const matchedInfo = result.matchedLine ? ` (매칭: "${result.matchedLine}")` : '';
    
    console.log(`\n📄 [페이지 ${pageNum}/${numPages}]`);
    console.log('─'.repeat(100));
    console.log(`📍 텍스트 범위: ${Math.floor((pageNum - 1) * avgPageLength).toLocaleString()} ~ ${Math.floor(pageNum * avgPageLength).toLocaleString()}자`);
    console.log(`📏 페이지 텍스트 길이: ${pageText.length}자\n`);
    
    // 하단 텍스트 출력 (디버깅용)
    const lines = pageText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    const bottomLines = lines.slice(-10); // 하단 10줄 표시
    
    if (result.success && result.value !== pageNum) {
      console.log(`${status} 추출 성공!`);
      console.log(`   뷰어 인덱스: ${pageNum}`);
      console.log(`   논리적 페이지 번호: ${result.value}`);
      console.log(`   추출 방법: ${result.method}`);
      if (result.matchedLine) {
        console.log(`   매칭된 라인: "${result.matchedLine}"`);
      }
      console.log(`   차이: ${result.value > pageNum ? '+' : ''}${result.value - pageNum}`);
      
      // 하단 텍스트 표시 (검증용)
      console.log(`\n   📋 하단 10줄 텍스트 (검증용):`);
      bottomLines.forEach((line, idx) => {
        const isMatched = line.includes(result.matchedLine || '');
        const marker = isMatched ? ' ⭐' : '';
        console.log(`      [${idx}] "${line}"${marker}`);
      });
    } else {
      console.log(`${status} 추출 실패 또는 뷰어 인덱스와 동일`);
      console.log(`   뷰어 인덱스: ${pageNum}`);
      console.log(`   논리적 페이지 번호: ${result.value} (동일)`);
      console.log(`   추출 방법: ${result.method || '폴백 (뷰어 인덱스)'}`);
      
      console.log(`\n   📋 하단 10줄 텍스트:`);
      bottomLines.forEach((line, idx) => {
        console.log(`      [${idx}] "${line}"`);
      });
    }
  }
  
  console.log('\n' + '='.repeat(100));
  console.log('📊 테스트 요약');
  console.log('='.repeat(100));
  const successCount = results.filter(r => r.success && r.logicalPageNumber !== r.viewerIndex).length;
  const totalCount = results.length;
  const successRate = ((successCount / totalCount) * 100).toFixed(1);
  
  console.log(`총 테스트 페이지: ${totalCount}개`);
  console.log(`✅ 성공적으로 추출된 페이지: ${successCount}개`);
  console.log(`⚠️ 추출 실패 또는 동일한 페이지: ${totalCount - successCount}개`);
  console.log(`📈 성공률: ${successRate}%\n`);
  console.log(`📋 상세 결과:`);
  results.forEach(r => {
    const status = r.success && r.logicalPageNumber !== r.viewerIndex ? '✅' : '⚠️';
    const diffInfo = r.logicalPageNumber !== r.viewerIndex ? ` (차이: ${r.diff > 0 ? '+' : ''}${r.diff})` : '';
    const matchInfo = r.matchedLine ? `\n      매칭: "${r.matchedLine}"` : '';
    console.log(`  ${status} 페이지 ${r.viewerIndex} → 논리적 페이지 ${r.logicalPageNumber}${diffInfo}${matchInfo}`);
  });
}

async function main() {
  try {
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
    
    // 특정 파일 우선 검색
    const targetFiles = manifest.filter(f => 
      f.includes('금연구역 지정 관리 업무지침_2025개정판') ||
      f.includes('금연지원서비스') || 
      f.includes('안내서') ||
      f.includes('해설집')
    );
    
    const pdfFile = targetFiles.length > 0 ? targetFiles[0] : manifest[0];
    const pdfPath = path.join(__dirname, '..', 'public', 'pdf', pdfFile);
    
    if (!fs.existsSync(pdfPath)) {
      console.error(`❌ PDF 파일을 찾을 수 없습니다: ${pdfPath}`);
      return;
    }
    
    console.log('🧪 논리적 페이지 번호 추출 테스트 (Firestore 저장 없음)');
    console.log('='.repeat(100));
    console.log(`\n📄 PDF 파일: ${pdfFile}\n`);
    
    await testWithPdfParse(pdfPath, [1, 10, 20, 30, 50, 65, 100, 124]);
    
  } catch (error) {
    console.error('❌ 테스트 중 오류 발생:', error);
    process.exit(1);
  }
}

main();
