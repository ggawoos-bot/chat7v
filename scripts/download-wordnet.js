/**
 * WordNet 데이터 다운로드 및 변환 스크립트
 * 외부 WordNet 소스에서 데이터를 다운로드하여 JSON 형식으로 변환
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const wordnetPath = path.join(__dirname, '../data/wordnet-korean.json');

/**
 * WordNet 데이터 다운로드 URL 목록
 */
const wordnetUrls = [
  // 한국어 WordNet/KorLex 소스 (실제 존재하는 URL로 교체 필요)
  // 'https://raw.githubusercontent.com/dongjo/wordnet/master/data/korlex.json',
  // 다른 WordNet 소스 추가 가능
];

/**
 * HTTP/HTTPS 요청으로 데이터 다운로드
 */
function downloadFile(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const client = urlObj.protocol === 'https:' ? https : http;
    
    console.log(`📥 다운로드 중: ${url}`);
    
    client.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
        return;
      }
      
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

/**
 * WordNet 데이터 형식 변환
 */
function convertWordNetData(rawData, sourceType = 'json') {
  const synonymMappings = {};
  
  try {
    let data;
    
    // JSON 파싱
    if (sourceType === 'json') {
      data = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
    } else {
      throw new Error(`지원하지 않는 형식: ${sourceType}`);
    }
    
    // 다양한 WordNet 형식 지원
    if (Array.isArray(data)) {
      // 배열 형식: [{word: "단어", synonyms: ["동의어1", "동의어2"]}, ...]
      data.forEach(item => {
        if (item.word && item.synonyms && Array.isArray(item.synonyms)) {
          synonymMappings[item.word] = item.synonyms;
        } else if (item.keyword && item.synonyms) {
          synonymMappings[item.keyword] = item.synonyms;
        }
      });
    } else if (data.synonymMappings) {
      // 객체 형식: {synonymMappings: {"단어": ["동의어1", "동의어2"], ...}}
      Object.assign(synonymMappings, data.synonymMappings);
    } else if (typeof data === 'object') {
      // 직접 매핑 형식: {"단어": ["동의어1", "동의어2"], ...}
      Object.assign(synonymMappings, data);
    }
    
    console.log(`✅ ${Object.keys(synonymMappings).length}개 키워드 변환 완료`);
    return synonymMappings;
  } catch (error) {
    console.error(`❌ 데이터 변환 실패: ${error.message}`);
    throw error;
  }
}

/**
 * WordNet 데이터를 파일로 저장
 */
function saveWordNetFile(synonymMappings, metadata = {}) {
  try {
    const dataDir = path.dirname(wordnetPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const output = {
      metadata: {
        source: metadata.source || 'WordNet',
        version: metadata.version || '1.0',
        createdAt: new Date().toISOString(),
        totalKeywords: Object.keys(synonymMappings).length,
        totalSynonyms: Object.values(synonymMappings).reduce(
          (sum, synonyms) => sum + (Array.isArray(synonyms) ? synonyms.length : 0), 0
        )
      },
      synonymMappings
    };

    fs.writeFileSync(wordnetPath, JSON.stringify(output, null, 2), 'utf8');
    console.log(`💾 WordNet 데이터 저장 완료: ${wordnetPath}`);
    console.log(`   - 총 키워드: ${output.metadata.totalKeywords}개`);
    console.log(`   - 총 동의어: ${output.metadata.totalSynonyms}개`);
    
    return wordnetPath;
  } catch (error) {
    console.error(`❌ 파일 저장 실패: ${error.message}`);
    throw error;
  }
}

/**
 * 로컬 파일에서 WordNet 데이터 로드 (수동 추가된 파일)
 */
function loadLocalWordNetFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      throw new Error(`파일이 존재하지 않습니다: ${filePath}`);
    }
    
    console.log(`📂 로컬 파일 로드: ${filePath}`);
    const rawData = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(rawData);
    
    return convertWordNetData(data);
  } catch (error) {
    console.error(`❌ 로컬 파일 로드 실패: ${error.message}`);
    throw error;
  }
}

/**
 * 메인 실행 함수
 */
async function main() {
  console.log('🚀 WordNet 데이터 다운로드 시작\n');
  
  let allSynonymMappings = {};
  
  // 1. URL에서 다운로드 시도
  for (const url of wordnetUrls) {
    try {
      const rawData = await downloadFile(url);
      const synonymMappings = convertWordNetData(rawData, 'json');
      Object.assign(allSynonymMappings, synonymMappings);
      console.log(`✅ ${url}에서 ${Object.keys(synonymMappings).length}개 키워드 다운로드 완료\n`);
    } catch (error) {
      console.warn(`⚠️ ${url} 다운로드 실패: ${error.message}\n`);
      continue;
    }
  }
  
  // 2. 명령줄 인자로 로컬 파일 경로가 제공된 경우
  const localFilePath = process.argv[2];
  if (localFilePath) {
    try {
      const synonymMappings = loadLocalWordNetFile(localFilePath);
      Object.assign(allSynonymMappings, synonymMappings);
      console.log(`✅ 로컬 파일에서 ${Object.keys(synonymMappings).length}개 키워드 로드 완료\n`);
    } catch (error) {
      console.error(`❌ 로컬 파일 처리 실패: ${error.message}\n`);
    }
  }
  
  // 3. 결과 저장
  if (Object.keys(allSynonymMappings).length > 0) {
    saveWordNetFile(allSynonymMappings, {
      source: wordnetUrls.length > 0 ? 'Downloaded' : 'Local',
      version: '1.0'
    });
    console.log('\n✅ WordNet 데이터 다운로드 및 변환 완료!');
  } else {
    console.log('\n⚠️ 다운로드된 WordNet 데이터가 없습니다.');
    console.log('   사용법:');
    console.log('   - URL에서 다운로드: wordnetUrls 배열에 URL 추가');
    console.log('   - 로컬 파일 로드: node scripts/download-wordnet.js <파일경로>');
  }
}

// 실행
main().catch(error => {
  console.error('❌ 실행 실패:', error);
  process.exit(1);
});

