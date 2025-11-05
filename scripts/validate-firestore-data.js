/**
 * Firestore 데이터 검증 스크립트
 * - Firestore 연결 테스트
 * - 데이터 품질 검증
 * - 컬렉션 존재 확인
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, limit } from 'firebase/firestore';

// Firebase 설정
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || "AIzaSyDyx_GGIDteLNZKspL0RqLdNfMA-uLXwq0",
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || "chat7-88761.firebaseapp.com",
  projectId: process.env.FIREBASE_PROJECT_ID || "chat7-88761",
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "chat7-88761.firebasestorage.app",
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "1090093126813",
  appId: process.env.FIREBASE_APP_ID || "1:1090093126813:web:3f8872dfe3c4f13c92f074"
};

async function validateFirestoreData() {
  try {
    console.log('🔍 Firestore 데이터 검증 시작...');
    
    // Firebase 앱 초기화
    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);
    
    console.log('✅ Firebase 앱 초기화 완료');
    
    // pdf_documents 컬렉션 검증
    console.log('📄 pdf_documents 컬렉션 검증 중...');
    const documentsQuery = query(collection(db, 'pdf_documents'), limit(1));
    const documentsSnapshot = await getDocs(documentsQuery);
    
    if (documentsSnapshot.empty) {
      console.log('⚠️ pdf_documents 컬렉션이 비어있습니다.');
    } else {
      console.log(`✅ pdf_documents 컬렉션 확인: ${documentsSnapshot.size}개 문서`);
    }
    
    // pdf_chunks 컬렉션 검증
    console.log('📦 pdf_chunks 컬렉션 검증 중...');
    const chunksQuery = query(collection(db, 'pdf_chunks'), limit(10));
    const chunksSnapshot = await getDocs(chunksQuery);
    
    if (chunksSnapshot.empty) {
      console.log('⚠️ pdf_chunks 컬렉션이 비어있습니다.');
    } else {
      console.log(`✅ pdf_chunks 컬렉션 확인: ${chunksSnapshot.size}개 청크`);
    }
    
    // 데이터 품질 검증
    console.log('🔍 데이터 품질 검증 중...');
    
    let totalChunks = 0;
    let validChunks = 0;
    
    chunksSnapshot.forEach((doc) => {
      const data = doc.data();
      totalChunks++;
      
      // 필수 필드 검증
      if (data.content && data.metadata && data.keywords) {
        validChunks++;
      }
    });
    
    const qualityScore = totalChunks > 0 ? (validChunks / totalChunks) * 100 : 0;
    
    console.log(`📊 데이터 품질 점수: ${qualityScore.toFixed(1)}%`);
    console.log(`  - 총 청크: ${totalChunks}개`);
    console.log(`  - 유효 청크: ${validChunks}개`);
    
    if (qualityScore < 80) {
      console.log('⚠️ 경고: 데이터 품질이 낮습니다.');
      return false;
    }
    
    console.log('✅ Firestore 데이터 검증 완료!');
    return true;
    
  } catch (error) {
    console.error('❌ Firestore 데이터 검증 실패:', error);
    return false;
  }
}

// 스크립트 실행
validateFirestoreData()
  .then((success) => {
    if (success) {
      console.log('🎉 모든 검증이 완료되었습니다!');
      process.exit(0);
    } else {
      console.log('❌ 검증에 실패했습니다.');
      process.exit(1);
    }
  })
  .catch((error) => {
    console.error('❌ 예상치 못한 오류:', error);
    process.exit(1);
  });
