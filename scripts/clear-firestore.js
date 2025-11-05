/**
 * Firestore 데이터 초기화 스크립트
 * 기존 pdf_documents와 pdf_chunks 컬렉션의 모든 데이터를 삭제
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, deleteDoc, doc, writeBatch } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyDyx_GGIDteLNZKspL0RqLdNfMA-uLXwq0",
  authDomain: "chat7-88761.firebaseapp.com",
  projectId: "chat7-88761",
  storageBucket: "chat7-88761.firebasestorage.app",
  messagingSenderId: "1090093126813",
  appId: "1:1090093126813:web:3f8872dfe3c4f13c92f074"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function clearFirestore() {
  try {
    console.log('🗑️ Firestore 데이터 일괄 초기화 시작...');
    
    // pdf_documents 컬렉션 일괄 삭제 (작은 배치로)
    console.log('📄 pdf_documents 컬렉션 일괄 삭제 중...');
    const documentsSnapshot = await getDocs(collection(db, 'pdf_documents'));
    const documents = documentsSnapshot.docs;
    
    if (documents.length > 0) {
      // 문서도 작은 배치로 나누어 처리 (안전하게)
      const docBatchSize = 100;
      let deletedDocs = 0;
      
      for (let i = 0; i < documents.length; i += docBatchSize) {
        const batch = writeBatch(db);
        const batchDocs = documents.slice(i, i + docBatchSize);
        
        batchDocs.forEach(docSnapshot => {
          batch.delete(doc(db, 'pdf_documents', docSnapshot.id));
        });
        
        await batch.commit();
        deletedDocs += batchDocs.length;
        console.log(`  ✓ 문서 삭제 진행: ${deletedDocs}/${documents.length}개 (${((deletedDocs / documents.length) * 100).toFixed(1)}%)`);
        
        // 짧은 딜레이 추가 (API 제한 방지)
        if (i + docBatchSize < documents.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      console.log(`✅ pdf_documents 삭제 완료: ${deletedDocs}개`);
    } else {
      console.log('📄 pdf_documents 컬렉션이 비어있습니다.');
    }
    
    // pdf_chunks 컬렉션 일괄 삭제 (더 작은 배치로)
    console.log('📦 pdf_chunks 컬렉션 일괄 삭제 중...');
    const chunksSnapshot = await getDocs(collection(db, 'pdf_chunks'));
    const chunks = chunksSnapshot.docs;
    let totalDeleted = 0;
    
    if (chunks.length > 0) {
      // 배치 크기를 100개로 줄임 (안전하게)
      const batchSize = 100;
      
      console.log(`📊 총 ${chunks.length}개 청크 삭제 시작...`);
      
      for (let i = 0; i < chunks.length; i += batchSize) {
        try {
          const batch = writeBatch(db);
          const batchChunks = chunks.slice(i, i + batchSize);
          
          batchChunks.forEach(chunkSnapshot => {
            batch.delete(doc(db, 'pdf_chunks', chunkSnapshot.id));
          });
          
          await batch.commit();
          totalDeleted += batchChunks.length;
          
          const progress = ((totalDeleted / chunks.length) * 100).toFixed(1);
          console.log(`  ✓ 청크 삭제 진행: ${totalDeleted}/${chunks.length}개 (${progress}%)`);
          
          // 배치 사이에 딜레이 추가 (API 제한 및 트랜잭션 부하 방지)
          if (i + batchSize < chunks.length) {
            await new Promise(resolve => setTimeout(resolve, 200));
          }
          
        } catch (error) {
          console.error(`  ❌ 배치 삭제 실패 (${i}-${Math.min(i + batchSize, chunks.length)}):`, error.message);
          // 에러가 발생해도 계속 진행
          // 실패한 배치는 다음 실행에서 처리할 수 있음
          
          // 재시도 전 대기
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      console.log(`✅ pdf_chunks 삭제 완료: ${totalDeleted}개`);
    } else {
      console.log('📦 pdf_chunks 컬렉션이 비어있습니다.');
    }
    
    console.log('\n🎉 Firestore 데이터 일괄 초기화 완료!');
    console.log(`📊 삭제된 데이터:`);
    console.log(`  - 문서: ${documents.length}개`);
    console.log(`  - 청크: ${totalDeleted}개`);
    
  } catch (error) {
    console.error('❌ 초기화 실패:', error);
    process.exit(1);
  }
}

// 스크립트 실행
clearFirestore();
