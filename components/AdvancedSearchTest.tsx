/**
 * 고급 검색 품질 테스트 컴포넌트
 */

import React, { useState } from 'react';
import { AdvancedSearchQualityService } from '../services/advancedSearchQualityService';
import { QuestionAnalyzer } from '../services/questionBasedContextService';

export const AdvancedSearchTest: React.FC = () => {
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const advancedSearchService = new AdvancedSearchQualityService();
  const questionAnalyzer = new QuestionAnalyzer();

  const handleTest = async () => {
    if (!question.trim()) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      console.log(`🧪 고급 검색 테스트 시작: "${question}"`);

      // 1. 질문 분석
      const questionAnalysis = await questionAnalyzer.analyzeQuestion(question);
      console.log('📊 질문 분석 결과:', questionAnalysis);

      // 2. 고급 검색 실행
      const searchResult = await advancedSearchService.executeAdvancedSearch(questionAnalysis);
      console.log('🔍 고급 검색 결과:', searchResult);

      // 3. 검색 통계 생성
      const statistics = advancedSearchService.generateSearchStatistics(searchResult);
      console.log('📈 검색 통계:', statistics);

      // 4. 품질 리포트 생성
      const qualityReport = advancedSearchService.generateQualityReport(searchResult);
      console.log('📋 품질 리포트:', qualityReport);

      setResult({
        questionAnalysis,
        searchResult,
        statistics,
        qualityReport
      });

    } catch (err) {
      console.error('❌ 테스트 실패:', err);
      setError(err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const testQuestions = [
    '체육시설은 금연구역인가요?',
    '어린이집 금연 규정은 무엇인가요?',
    '금연구역 지정 절차는 어떻게 되나요?',
    '체육시설과 어린이집 금연 정책의 차이점은?',
    '금연 정책의 법적 근거는 무엇인가요?'
  ];

  return (
    <div className="advanced-search-test">
      <h2>🚀 고급 검색 품질 테스트</h2>
      
      <div className="test-input">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="테스트할 질문을 입력하세요..."
          className="question-input"
        />
        <button onClick={handleTest} disabled={loading || !question.trim()}>
          {loading ? '테스트 중...' : '테스트 실행'}
        </button>
      </div>

      <div className="quick-tests">
        <h3>빠른 테스트</h3>
        {testQuestions.map((testQ, index) => (
          <button
            key={index}
            onClick={() => setQuestion(testQ)}
            className="quick-test-btn"
          >
            {testQ}
          </button>
        ))}
      </div>

      {error && (
        <div className="error">
          <h3>❌ 오류</h3>
          <p>{error}</p>
        </div>
      )}

      {result && (
        <div className="test-results">
          <h3>📊 테스트 결과</h3>
          
          <div className="result-section">
            <h4>🔍 질문 분석</h4>
            <div className="analysis-info">
              <p><strong>의도:</strong> {result.questionAnalysis.intent}</p>
              <p><strong>카테고리:</strong> {result.questionAnalysis.category}</p>
              <p><strong>복잡도:</strong> {result.questionAnalysis.complexity}</p>
              <p><strong>키워드:</strong> {result.questionAnalysis.keywords.join(', ')}</p>
              {result.questionAnalysis.expandedKeywords && (
                <p><strong>확장 키워드:</strong> {result.questionAnalysis.expandedKeywords.join(', ')}</p>
              )}
            </div>
          </div>

          <div className="result-section">
            <h4>🔍 검색 결과</h4>
            <div className="search-info">
              <p><strong>선택된 청크:</strong> {result.searchResult.chunks.length}개</p>
              <p><strong>평균 관련성:</strong> {result.searchResult.searchMetrics.averageRelevance.toFixed(3)}</p>
              <p><strong>검색 범위:</strong> {result.searchResult.searchMetrics.searchCoverage.toFixed(3)}</p>
              <p><strong>결과 다양성:</strong> {result.searchResult.searchMetrics.resultDiversity.toFixed(3)}</p>
              <p><strong>실행 시간:</strong> {result.searchResult.searchMetrics.executionTime}ms</p>
            </div>
          </div>

          <div className="result-section">
            <h4>📈 검색 통계</h4>
            <div className="statistics-info">
              <p><strong>총 실행 시간:</strong> {result.statistics.totalExecutionTime}ms</p>
              <p><strong>검색 효율성:</strong> {result.statistics.searchEfficiency}</p>
              <p><strong>성공한 단계:</strong> {result.statistics.performanceMetrics.stagesSuccessful}/{result.statistics.performanceMetrics.stagesExecuted}</p>
            </div>
          </div>

          <div className="result-section">
            <h4>📋 품질 리포트</h4>
            <div className="quality-info">
              <p><strong>전체 점수:</strong> {result.qualityReport.overallScore}</p>
              
              {result.qualityReport.strengths.length > 0 && (
                <div>
                  <strong>강점:</strong>
                  <ul>
                    {result.qualityReport.strengths.map((strength, index) => (
                      <li key={index}>{strength}</li>
                    ))}
                  </ul>
                </div>
              )}

              {result.qualityReport.weaknesses.length > 0 && (
                <div>
                  <strong>약점:</strong>
                  <ul>
                    {result.qualityReport.weaknesses.map((weakness, index) => (
                      <li key={index}>{weakness}</li>
                    ))}
                  </ul>
                </div>
              )}

              {result.qualityReport.recommendations.length > 0 && (
                <div>
                  <strong>개선 권장사항:</strong>
                  <ul>
                    {result.qualityReport.recommendations.map((recommendation, index) => (
                      <li key={index}>{recommendation}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>

          <div className="result-section">
            <h4>📦 선택된 청크</h4>
            <div className="chunks-info">
              {result.searchResult.chunks.map((chunk, index) => (
                <div key={index} className="chunk-item">
                  <h5>청크 {index + 1}</h5>
                  <p><strong>내용:</strong> {chunk.content.substring(0, 200)}...</p>
                  <p><strong>관련성 점수:</strong> {chunk.qualityMetrics.relevanceScore.toFixed(3)}</p>
                  <p><strong>전체 점수:</strong> {chunk.qualityMetrics.overallScore.toFixed(3)}</p>
                  <p><strong>문서 유형:</strong> {chunk.contextInfo.documentType}</p>
                  <p><strong>중요도:</strong> {chunk.contextInfo.importance}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .advanced-search-test {
          padding: 20px;
          max-width: 1200px;
          margin: 0 auto;
        }

        .test-input {
          display: flex;
          gap: 10px;
          margin-bottom: 20px;
        }

        .question-input {
          flex: 1;
          padding: 10px;
          border: 1px solid #ddd;
          border-radius: 4px;
        }

        button {
          padding: 10px 20px;
          background: #007bff;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
        }

        button:disabled {
          background: #ccc;
          cursor: not-allowed;
        }

        .quick-tests {
          margin-bottom: 20px;
        }

        .quick-test-btn {
          margin: 5px;
          padding: 8px 12px;
          background: #f8f9fa;
          border: 1px solid #ddd;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
        }

        .quick-test-btn:hover {
          background: #e9ecef;
        }

        .error {
          background: #f8d7da;
          color: #721c24;
          padding: 15px;
          border-radius: 4px;
          margin-bottom: 20px;
        }

        .test-results {
          background: #f8f9fa;
          padding: 20px;
          border-radius: 8px;
        }

        .result-section {
          margin-bottom: 30px;
          padding: 15px;
          background: white;
          border-radius: 4px;
          border-left: 4px solid #007bff;
        }

        .result-section h4 {
          margin-top: 0;
          color: #007bff;
        }

        .analysis-info, .search-info, .statistics-info, .quality-info {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 10px;
        }

        .chunks-info {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: 15px;
        }

        .chunk-item {
          background: #f8f9fa;
          padding: 15px;
          border-radius: 4px;
          border: 1px solid #dee2e6;
        }

        .chunk-item h5 {
          margin-top: 0;
          color: #495057;
        }

        ul {
          margin: 5px 0;
          padding-left: 20px;
        }

        li {
          margin: 3px 0;
        }
      `}</style>
    </div>
  );
};
