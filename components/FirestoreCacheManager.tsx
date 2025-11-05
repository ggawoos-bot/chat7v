import React, { useState, useEffect } from 'react';
import { FirestoreCacheService } from '../services/firestoreCacheService';

interface CacheStatus {
  totalCaches: number;
  validCaches: number;
  documentCaches: number;
  chunkCaches: number;
  searchCaches: number;
  textSearchCaches: number;
  totalSize: string;
  cacheExpiry: string;
}

export const FirestoreCacheManager: React.FC = () => {
  const [cacheStatus, setCacheStatus] = useState<CacheStatus | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isVisible) {
      updateCacheStatus();
    }
  }, [isVisible]);

  const updateCacheStatus = () => {
    try {
      const status = FirestoreCacheService.getCacheStatus();
      setCacheStatus(status);
    } catch (error) {
      console.error('캐시 상태 조회 실패:', error);
    }
  };

  const clearAllCache = () => {
    if (confirm('모든 Firestore 캐시를 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.')) {
      setIsLoading(true);
      try {
        FirestoreCacheService.clearAllFirestoreCache();
        updateCacheStatus();
        alert('Firestore 캐시가 삭제되었습니다.');
      } catch (error) {
        console.error('캐시 삭제 실패:', error);
        alert('캐시 삭제 중 오류가 발생했습니다.');
      } finally {
        setIsLoading(false);
      }
    }
  };

  const clearExpiredCache = async () => {
    if (confirm('만료된 캐시만 삭제하시겠습니까?')) {
      setIsLoading(true);
      try {
        // FirestoreCacheService를 통한 만료된 캐시 정리
        alert('IndexedDB에서 자동으로 만료된 캐시가 정리됩니다.');
        updateCacheStatus();
      } catch (error) {
        console.error('만료된 캐시 삭제 실패:', error);
        alert('만료된 캐시 삭제 중 오류가 발생했습니다.');
      } finally {
        setIsLoading(false);
      }
    }
  };

  const refreshCache = () => {
    setIsLoading(true);
    setTimeout(() => {
      updateCacheStatus();
      setIsLoading(false);
    }, 500);
  };

  if (!isVisible) {
    return (
      <button 
        onClick={() => setIsVisible(true)}
        className="cache-toggle-btn"
        title="캐시관리"
        style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          width: '50px',
          height: '50px',
          borderRadius: '50%',
          backgroundColor: '#4CAF50',
          color: 'white',
          border: 'none',
          cursor: 'pointer',
          fontSize: '20px',
          boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
          zIndex: 1000
        }}
      >
        📦
      </button>
    );
  }

  return (
    <div 
      className="firestore-cache-manager"
      style={{
        position: 'fixed',
        top: '20px',
        right: '20px',
        width: '350px',
        backgroundColor: 'white',
        border: '1px solid #ddd',
        borderRadius: '8px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
        zIndex: 1001,
        fontFamily: 'Arial, sans-serif'
      }}
    >
      <div 
        className="cache-header"
        style={{
          padding: '15px',
          borderBottom: '1px solid #eee',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: '#f8f9fa'
        }}
      >
        <h3 style={{ margin: 0, fontSize: '16px', color: '#333' }}>
          Firestore 캐시 관리
        </h3>
        <button 
          onClick={() => setIsVisible(false)}
          style={{
            background: 'none',
            border: 'none',
            fontSize: '18px',
            cursor: 'pointer',
            color: '#666'
          }}
        >
          ✕
        </button>
      </div>
      
      <div 
        className="cache-status"
        style={{
          padding: '15px',
          borderBottom: '1px solid #eee'
        }}
      >
        {cacheStatus ? (
          <div>
            <div style={{ marginBottom: '8px' }}>
              <strong>전체 캐시:</strong> {cacheStatus.totalCaches}개
            </div>
            <div style={{ marginBottom: '8px' }}>
              <strong>유효한 캐시:</strong> {cacheStatus.validCaches}개
            </div>
            <div style={{ marginBottom: '8px' }}>
              <strong>문서 캐시:</strong> {cacheStatus.documentCaches}개
            </div>
            <div style={{ marginBottom: '8px' }}>
              <strong>청크 캐시:</strong> {cacheStatus.chunkCaches}개
            </div>
            <div style={{ marginBottom: '8px' }}>
              <strong>검색 캐시:</strong> {cacheStatus.searchCaches}개
            </div>
            <div style={{ marginBottom: '8px' }}>
              <strong>텍스트 검색 캐시:</strong> {cacheStatus.textSearchCaches}개
            </div>
            <div style={{ marginBottom: '8px' }}>
              <strong>총 크기:</strong> {cacheStatus.totalSize}
            </div>
            <div style={{ marginBottom: '8px' }}>
              <strong>캐시 만료:</strong> {cacheStatus.cacheExpiry}
            </div>
          </div>
        ) : (
          <div>캐시 상태를 불러오는 중...</div>
        )}
      </div>
      
      <div 
        className="cache-actions"
        style={{
          padding: '15px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px'
        }}
      >
        <button 
          onClick={refreshCache}
          disabled={isLoading}
          style={{
            padding: '8px 16px',
            backgroundColor: '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: isLoading ? 'not-allowed' : 'pointer',
            opacity: isLoading ? 0.6 : 1
          }}
        >
          {isLoading ? '새로고침 중...' : '새로고침'}
        </button>
        
        <button 
          onClick={clearExpiredCache}
          disabled={isLoading}
          style={{
            padding: '8px 16px',
            backgroundColor: '#ffc107',
            color: 'black',
            border: 'none',
            borderRadius: '4px',
            cursor: isLoading ? 'not-allowed' : 'pointer',
            opacity: isLoading ? 0.6 : 1
          }}
        >
          만료된 캐시 삭제
        </button>
        
        <button 
          onClick={clearAllCache}
          disabled={isLoading}
          style={{
            padding: '8px 16px',
            backgroundColor: '#dc3545',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: isLoading ? 'not-allowed' : 'pointer',
            opacity: isLoading ? 0.6 : 1
          }}
        >
          전체 캐시 삭제
        </button>
      </div>
      
      <div 
        className="cache-info"
        style={{
          padding: '10px 15px',
          backgroundColor: '#f8f9fa',
          fontSize: '12px',
          color: '#666',
          borderTop: '1px solid #eee'
        }}
      >
        💡 캐시는 브라우저에 저장되며, 검색 속도를 향상시킵니다.
      </div>
    </div>
  );
};
