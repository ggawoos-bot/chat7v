import React, { useState, useEffect } from 'react';
import { CompressionResult } from '../services/pdfCompressionService';
import { rpdService, RpdStats } from '../services/rpdService';

interface CompressionStatsProps {
  compressionResult: CompressionResult | null;
  isVisible: boolean;
  onClose: () => void;
}

const CompressionStats: React.FC<CompressionStatsProps> = ({ 
  compressionResult, 
  isVisible, 
  onClose 
}) => {
  const [rpdStats, setRpdStats] = useState<RpdStats | null>(null);
  const [activeTab, setActiveTab] = useState<'compression' | 'rpd'>('rpd');

  useEffect(() => {
    if (isVisible) {
      setRpdStats(rpdService.getRpdStats());
    }
  }, [isVisible]);

  if (!isVisible) return null;

  const formatNumber = (num: number) => num.toLocaleString();
  const formatPercentage = (num: number) => `${(num * 100).toFixed(1)}%`;

  const handleToggleKey = (keyId: string) => {
    rpdService.toggleKeyStatus(keyId);
    setRpdStats(rpdService.getRpdStats());
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-brand-surface border border-brand-secondary rounded-lg p-6 max-w-4xl w-full mx-4 max-h-[80vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-brand-text-primary">
            사용량 통계
          </h3>
          <button
            onClick={onClose}
            className="text-brand-text-secondary hover:text-brand-text-primary transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 탭 메뉴 */}
        <div className="flex space-x-1 mb-6 bg-brand-bg rounded-lg p-1">
          <button
            onClick={() => setActiveTab('compression')}
            className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'compression'
                ? 'bg-brand-primary text-white'
                : 'text-brand-text-secondary hover:text-brand-text-primary'
            }`}
          >
            PDF 압축 통계
          </button>
          <button
            onClick={() => setActiveTab('rpd')}
            className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'rpd'
                ? 'bg-brand-primary text-white'
                : 'text-brand-text-secondary hover:text-brand-text-primary'
            }`}
          >
            API 사용량 (RPD)
          </button>
        </div>

        {/* 압축 통계 탭 */}
        {activeTab === 'compression' && compressionResult && (
          <div className="space-y-4">
            {/* 기본 통계 */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-brand-bg rounded-lg p-4">
                <div className="text-sm text-brand-text-secondary mb-1">원본 크기</div>
                <div className="text-lg font-semibold text-brand-text-primary">
                  {formatNumber(compressionResult.originalLength)}자
                </div>
              </div>
              <div className="bg-brand-bg rounded-lg p-4">
                <div className="text-sm text-brand-text-secondary mb-1">압축 후 크기</div>
                <div className="text-lg font-semibold text-brand-text-primary">
                  {formatNumber(compressionResult.compressedLength)}자
                </div>
              </div>
            </div>

            {/* 압축률 */}
            <div className="bg-brand-bg rounded-lg p-4">
              <div className="text-sm text-brand-text-secondary mb-2">압축률</div>
              <div className="flex items-center space-x-4">
                <div className="text-2xl font-bold text-brand-primary">
                  {formatPercentage(compressionResult.compressionRatio)}
                </div>
                <div className="flex-1 bg-brand-secondary rounded-full h-2">
                  <div 
                    className="bg-brand-primary h-2 rounded-full transition-all duration-300"
                    style={{ width: `${Math.min(100, compressionResult.compressionRatio * 100)}%` }}
                  />
                </div>
              </div>
            </div>

            {/* 토큰 정보 */}
            <div className="bg-brand-bg rounded-lg p-4">
              <div className="text-sm text-brand-text-secondary mb-1">예상 토큰 수</div>
              <div className="text-lg font-semibold text-brand-text-primary">
                {formatNumber(compressionResult.estimatedTokens)}개
              </div>
              <div className="text-xs text-brand-text-secondary mt-1">
                (Gemini 2.5 Flash 제한: 1,000,000 토큰)
              </div>
            </div>

            {/* 품질 점수 */}
            <div className="bg-brand-bg rounded-lg p-4">
              <div className="text-sm text-brand-text-secondary mb-2">품질 점수</div>
              <div className="flex items-center space-x-4">
                <div className="text-2xl font-bold text-brand-primary">
                  {compressionResult.qualityScore.toFixed(1)}점
                </div>
                <div className="flex-1 bg-brand-secondary rounded-full h-2">
                  <div 
                    className={`h-2 rounded-full transition-all duration-300 ${
                      compressionResult.qualityScore >= 80 ? 'bg-green-500' :
                      compressionResult.qualityScore >= 60 ? 'bg-yellow-500' : 'bg-red-500'
                    }`}
                    style={{ width: `${Math.min(100, compressionResult.qualityScore)}%` }}
                  />
                </div>
              </div>
              <div className="text-xs text-brand-text-secondary mt-1">
                {compressionResult.qualityScore >= 80 ? '우수' :
                 compressionResult.qualityScore >= 60 ? '양호' : '개선 필요'}
              </div>
            </div>

            {/* 절약된 토큰 */}
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <div className="text-sm text-green-700 mb-1">토큰 절약</div>
              <div className="text-lg font-semibold text-green-800">
                {formatNumber(compressionResult.originalLength / 4 - compressionResult.estimatedTokens)}개
              </div>
              <div className="text-xs text-green-600 mt-1">
                비용 절약 및 응답 속도 향상
              </div>
            </div>
          </div>
        )}

        {/* RPD 통계 탭 */}
        {activeTab === 'rpd' && rpdStats && (
          <div className="space-y-4">
            {/* 전체 사용량 요약 */}
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-4">
              <div className="text-sm text-blue-700 mb-2">전체 API 사용량</div>
              <div className="flex items-center justify-between">
                <div className="text-2xl font-bold text-blue-800">
                  {rpdStats.totalUsed} / {rpdStats.totalMax}
                </div>
                <div className="text-sm text-blue-600">
                  남은 요청: {rpdStats.remaining}회
                </div>
              </div>
              <div className="mt-2 bg-blue-200 rounded-full h-2">
                <div 
                  className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${rpdService.getUsagePercentage(rpdStats.totalUsed, rpdStats.totalMax)}%` }}
                />
              </div>
              <div className="text-xs text-blue-600 mt-1">
                리셋까지: {rpdService.getTimeUntilReset()}
              </div>
            </div>

            {/* API 키별 상세 정보 */}
            <div className="space-y-3">
              <h4 className="text-md font-semibold text-brand-text-primary">API 키별 사용량</h4>
              {rpdStats.apiKeys.map((keyInfo) => {
                const usagePercentage = rpdService.getUsagePercentage(keyInfo.usedToday, keyInfo.maxPerDay);
                const statusColor = rpdService.getUsageStatusColor(usagePercentage);
                const statusText = rpdService.getUsageStatusText(usagePercentage);
                
                return (
                  <div key={keyInfo.keyId} className="bg-brand-bg rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center space-x-2">
                        <span className="font-medium text-brand-text-primary">
                          {keyInfo.keyName}
                        </span>
                        <span className="text-xs text-brand-text-secondary font-mono">
                          {keyInfo.maskedKey}
                        </span>
                        <span className={`px-2 py-1 rounded-full text-xs ${
                          keyInfo.isActive 
                            ? 'bg-green-100 text-green-800' 
                            : 'bg-red-100 text-red-800'
                        }`}>
                          {keyInfo.isActive ? '활성' : '비활성'}
                        </span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <span className={`text-xs px-2 py-1 rounded-full ${
                          statusColor === 'bg-red-500' ? 'bg-red-100 text-red-800' :
                          statusColor === 'bg-yellow-500' ? 'bg-yellow-100 text-yellow-800' :
                          'bg-green-100 text-green-800'
                        }`}>
                          {statusText}
                        </span>
                        <button
                          onClick={() => handleToggleKey(keyInfo.keyId)}
                          className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                            keyInfo.isActive
                              ? 'bg-red-100 text-red-700 hover:bg-red-200'
                              : 'bg-green-100 text-green-700 hover:bg-green-200'
                          }`}
                        >
                          {keyInfo.isActive ? '비활성화' : '활성화'}
                        </button>
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-brand-text-secondary">
                        {keyInfo.usedToday} / {keyInfo.maxPerDay}회
                      </span>
                      <span className="text-sm text-brand-text-secondary">
                        {formatPercentage(usagePercentage / 100)}
                      </span>
                    </div>
                    
                    <div className="bg-brand-secondary rounded-full h-2">
                      <div 
                        className={`h-2 rounded-full transition-all duration-300 ${statusColor}`}
                        style={{ width: `${usagePercentage}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 사용 가이드 */}
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <div className="text-sm text-yellow-800 mb-2">💡 사용 가이드</div>
              <ul className="text-xs text-yellow-700 space-y-1">
                <li>• 각 API 키당 최대 250회/일 사용 가능</li>
                <li>• 총 750회/일 제한 (3개 키 합계)</li>
                <li>• 매일 자정에 사용량이 자동 리셋됩니다</li>
                <li>• 키를 비활성화하면 해당 키는 사용되지 않습니다</li>
                <li>• API 키는 보안을 위해 마스킹되어 표시됩니다</li>
              </ul>
            </div>
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-brand-primary text-white rounded-lg hover:bg-opacity-80 transition-colors"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
};

export default CompressionStats;
