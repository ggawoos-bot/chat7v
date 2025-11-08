import React from 'react';

/**
 * 텍스트에서 검색어를 하이라이트 처리하는 함수 (복수 단어 지원 + 문장 하이라이트)
 * @param text - 하이라이트할 텍스트
 * @param searchTerm - 검색어 (공백으로 구분된 복수 단어 지원)
 * @returns React.ReactNode - 하이라이트된 텍스트
 */
export const highlightSearchTerm = (text: string, searchTerm: string): React.ReactNode => {
  if (!searchTerm || !text) return text;

  // ✅ 방안 2: 공백으로 구분된 단어들을 각각 하이라이트
  const searchTerms = searchTerm
    .split(/\s+/)
    .map(term => term.trim())
    .filter(term => term.length > 0);
  
  // 단일 검색어인 경우 기존 방식 사용
  if (searchTerms.length === 1) {
    const escapedSearchTerm = searchTerms[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escapedSearchTerm})`, 'gi');
    const parts = text.split(regex);

    return parts.map((part, index) => {
      const isMatch = part.toLowerCase() === searchTerms[0].toLowerCase();
      return isMatch ? (
        <span key={index} className="search-highlight bg-yellow-200 text-yellow-900 font-bold px-0.5 rounded">
          {part}
        </span>
      ) : (
        part
      );
    });
  }
  
  // ✅ 복수 검색어인 경우: 문장 단위 하이라이트 + 개별 단어 하이라이트
  // 1단계: 문장으로 분할하고 2개 이상의 검색어가 포함된 문장 찾기
  const sentenceRegex = /([^.。!！?？\n]+[.。!！?？\n]+)/g;
  const sentenceMatches: { start: number; end: number; sentence: string }[] = [];
  let match;
  
  while ((match = sentenceRegex.exec(text)) !== null) {
    const sentenceText = match[0].trim();
    if (sentenceText.length < 5) continue; // 너무 짧은 문장은 스킵
    
    const normalizedSentence = sentenceText.toLowerCase();
    
    // 문장에 포함된 검색어 개수 확인
    const matchedTermsCount = searchTerms.filter(term => 
      normalizedSentence.includes(term.toLowerCase())
    ).length;
    
    // 2개 이상의 검색어가 포함된 경우
    if (matchedTermsCount >= 2) {
      sentenceMatches.push({
        start: match.index,
        end: match.index + match[0].length,
        sentence: sentenceText
      });
    }
  }
  
  // 마지막 문장 처리 (문장 종료 문자가 없는 경우)
  const lastSentenceStart = sentenceMatches.length > 0 
    ? sentenceMatches[sentenceMatches.length - 1].end 
    : 0;
  if (lastSentenceStart < text.length) {
    const lastSentence = text.substring(lastSentenceStart).trim();
    if (lastSentence.length >= 5) {
      const normalizedLastSentence = lastSentence.toLowerCase();
      const matchedTermsCount = searchTerms.filter(term => 
        normalizedLastSentence.includes(term.toLowerCase())
      ).length;
      
      if (matchedTermsCount >= 2) {
        sentenceMatches.push({
          start: lastSentenceStart,
          end: text.length,
          sentence: lastSentence
        });
      }
    }
  }
  
  // 2단계: 6줄 이상인 문장 하이라이트 제외
  const filteredSentenceMatches = sentenceMatches.filter(match => {
    const sentenceText = text.substring(match.start, match.end);
    const lineCount = (sentenceText.match(/\n/g) || []).length + 1; // 줄바꿈 개수 + 1
    return lineCount < 6; // 6줄 미만만 허용
  });
  
  // 3단계: 문장 하이라이트와 단어 하이라이트를 결합
  let highlightedText: React.ReactNode[] = [];
  let lastIndex = 0;
  
  // 문장 하이라이트가 있는 경우
  if (filteredSentenceMatches.length > 0) {
    filteredSentenceMatches.forEach((match, matchIndex) => {
      // 문장 이전 텍스트
      if (match.start > lastIndex) {
        const beforeText = text.substring(lastIndex, match.start);
        highlightedText.push(beforeText);
      }
      
      // 문장 전체를 하이라이트 (배경색으로, 텍스트는 파란색)
      const sentenceText = text.substring(match.start, match.end);
      highlightedText.push(
        <span 
          key={`sentence-${matchIndex}`}
          className="search-sentence-highlight bg-yellow-100 text-blue-600 px-1 rounded"
        >
          {sentenceText}
        </span>
      );
      
      lastIndex = match.end;
    });
    
    // 마지막 문장 이후 텍스트
    if (lastIndex < text.length) {
      highlightedText.push(text.substring(lastIndex));
    }
    
    // 3단계: 개별 단어도 하이라이트 적용 (문장 하이라이트 위에 + 문장 외부에도)
    searchTerms.forEach((term, termIndex) => {
      const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(${escapedTerm})`, 'gi');
      
      const newParts: React.ReactNode[] = [];
      
      highlightedText.forEach((part) => {
        if (typeof part === 'string') {
          // 하이라이트되지 않은 텍스트에서도 개별 단어 하이라이트
          const parts = part.split(regex);
          parts.forEach((p, i) => {
            const isMatch = p.toLowerCase() === term.toLowerCase();
            if (isMatch) {
              newParts.push(
                <span 
                  key={`term-${termIndex}-part-${i}-${newParts.length}`} 
                  className="search-highlight bg-yellow-200 text-yellow-900 font-bold px-0.5 rounded"
                >
                  {p}
                </span>
              );
            } else if (p) {
              newParts.push(p);
            }
          });
        } else if (React.isValidElement(part)) {
          // 이미 하이라이트된 부분 (문장 하이라이트)은 내부 텍스트만 처리
          const children = part.props.children;
          
          if (typeof children === 'string') {
            const parts = children.split(regex);
            const sentenceParts: React.ReactNode[] = [];
            
            parts.forEach((p, i) => {
              const isMatch = p.toLowerCase() === term.toLowerCase();
              if (isMatch) {
                sentenceParts.push(
                  <span 
                    key={`sentence-term-${termIndex}-${i}`}
                    className="search-highlight bg-yellow-300 text-blue-700 font-bold px-0.5 rounded"
                  >
                    {p}
                  </span>
                );
              } else if (p) {
                sentenceParts.push(p);
              }
            });
            
            // 문장 하이라이트 안에 단어 하이라이트 포함
            newParts.push(
              <span 
                key={part.key || `sentence-${termIndex}-${newParts.length}`}
                className={part.props.className}
              >
                {sentenceParts}
              </span>
            );
          } else {
            // children이 string이 아닌 경우 그대로 유지
            newParts.push(part);
          }
        } else {
          newParts.push(part);
        }
      });
      
      highlightedText = newParts;
    });
  } else {
    // 문장 하이라이트가 없으면 모든 검색어를 개별적으로만 하이라이트
    let highlightedTextNode: React.ReactNode = text;
    
    searchTerms.forEach((term, termIndex) => {
      const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(${escapedTerm})`, 'gi');
      
      // 현재 highlightedTextNode를 처리하는 함수
      const processNode = (node: React.ReactNode): React.ReactNode => {
        if (typeof node === 'string') {
          const parts = node.split(regex);
          return parts.map((part, i) => {
            const isMatch = part.toLowerCase() === term.toLowerCase();
            if (isMatch) {
              return (
                <span 
                  key={`term-${termIndex}-${i}`}
                  className="search-highlight bg-yellow-200 text-yellow-900 font-bold px-0.5 rounded"
                >
                  {part}
                </span>
              );
            }
            return part;
          });
        } else if (React.isValidElement(node)) {
          const children = node.props.children;
          if (typeof children === 'string') {
            const parts = children.split(regex);
            const newChildren = parts.map((part, i) => {
              const isMatch = part.toLowerCase() === term.toLowerCase();
              if (isMatch) {
                return (
                  <span 
                    key={`nested-term-${termIndex}-${i}`}
                    className="search-highlight bg-yellow-200 text-yellow-900 font-bold px-0.5 rounded"
                  >
                    {part}
                  </span>
                );
              }
              return part;
            });
            return React.cloneElement(node, { key: node.key || `wrapper-${termIndex}` }, newChildren);
          } else if (Array.isArray(children)) {
            const newChildren = children.map((child, idx) => {
              if (typeof child === 'string') {
                const parts = child.split(regex);
                return parts.map((part, i) => {
                  const isMatch = part.toLowerCase() === term.toLowerCase();
                  if (isMatch) {
                    return (
                      <span 
                        key={`array-term-${termIndex}-${idx}-${i}`}
                        className="search-highlight bg-yellow-200 text-yellow-900 font-bold px-0.5 rounded"
                      >
                        {part}
                      </span>
                    );
                  }
                  return part;
                });
              }
              return processNode(child);
            });
            return React.cloneElement(node, { key: node.key || `wrapper-${termIndex}` }, newChildren);
          }
          return node;
        } else if (Array.isArray(node)) {
          return node.map((item, idx) => (
            <React.Fragment key={`fragment-${termIndex}-${idx}`}>
              {processNode(item)}
            </React.Fragment>
          ));
        }
        return node;
      };
      
      highlightedTextNode = processNode(highlightedTextNode);
    });
    
    highlightedText = [highlightedTextNode];
  }
  
  return <>{highlightedText}</>;
};

/**
 * 질문 내용에서 의미있는 단어들을 추출하여 하이라이트하는 함수
 * @param text - 하이라이트할 텍스트
 * @param question - 질문 내용
 * @returns React.ReactNode - 하이라이트된 텍스트
 */
export const highlightQuestionWords = (text: string, question: string): React.ReactNode => {
  if (!question || !text) {
    return text;
  }

  // 한국어 조사 및 불용어
  const stopWords = ['은', '는', '이', '가', '을', '를', '에', '의', '와', '과', '도', '만', '조차', '마저', '까지', '부터', '에서', '에게', '한테', '께', '로', '으로', '것', '수', '있', '없', '되', '하', '등', '때', '경우', '위해', '때문', '인가', '인가요', '인지', '인지요', '있습니', '없습니', '입니다', '까요', '나요', '네요', '세요', '주세요', '해주세요', '이야', '이야요', '야', '어', '요'];
  
  // 1. 질문을 공백과 구두점으로 분리
  const wordsFromSpaces = question
    .replace(/[^\w가-힣\s]/g, ' ') // 구두점 제거
    .split(/\s+/) // 공백으로 분리
    .filter(word => word.trim().length >= 2); // 2글자 이상만
  
  // 2. 한국어 단어에서 조사 제거 (예: "어린이집은" → "어린이집")
  const wordsWithoutParticles = wordsFromSpaces.map(word => {
    // 조사가 붙어있는 경우 제거 (은, 는, 이, 가, 을, 를, 에, 의, 와, 과, 도, 만 등)
    for (const particle of ['은', '는', '이', '가', '을', '를', '에', '의', '와', '과', '도', '만', '에서', '에게', '한테', '께', '로', '으로']) {
      if (word.endsWith(particle) && word.length > particle.length) {
        return word.slice(0, -particle.length);
      }
    }
    return word;
  }).filter(word => word.length >= 2 && !stopWords.includes(word));
  
  // 3. 질문 자체에서 2글자 이상의 연속된 한글/영문 추출 (공백 없이도 작동)
  const continuousWords: string[] = [];
  const koreanWordRegex = /[가-힣]{2,}/g;
  const englishWordRegex = /[A-Za-z]{2,}/g;
  
  let match;
  while ((match = koreanWordRegex.exec(question)) !== null) {
    const word = match[0];
    // 조사 제거
    let cleanedWord = word;
    for (const particle of ['은', '는', '이', '가', '을', '를', '에', '의', '와', '과', '도', '만', '에서', '에게', '한테', '께', '로', '으로', '이야', '이야요', '야']) {
      if (cleanedWord.endsWith(particle) && cleanedWord.length > particle.length) {
        cleanedWord = cleanedWord.slice(0, -particle.length);
      }
    }
    if (cleanedWord.length >= 2 && !stopWords.includes(cleanedWord) && !continuousWords.includes(cleanedWord)) {
      continuousWords.push(cleanedWord);
    }
  }
  
  while ((match = englishWordRegex.exec(question)) !== null) {
    const word = match[0].toLowerCase();
    if (!stopWords.includes(word) && !continuousWords.includes(word)) {
      continuousWords.push(word);
    }
  }
  
  // 4. 모든 단어 합치기 (중복 제거)
  const allWords = Array.from(new Set([...wordsWithoutParticles, ...continuousWords]))
    .filter(word => word.length >= 2 && !stopWords.includes(word));

  if (allWords.length === 0) {
    return text;
  }

  // 각 단어를 정규식으로 이스케이프하고 패턴 생성
  const patterns = allWords.map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  
  // 모든 패턴을 하나의 정규식으로 결합
  const combinedPattern = `(${patterns.join('|')})`;
  const regex = new RegExp(combinedPattern, 'gi');

  // 텍스트를 분할하고 매칭된 부분을 하이라이트
  const parts = text.split(regex);
  
  return parts.map((part, index) => {
    // 분할된 부분이 정규식에 매칭된 단어인지 확인 (홀수 인덱스는 매칭된 부분)
    const isMatched = index % 2 === 1;
    
    return isMatched ? (
      <span key={index} className="question-highlight bg-blue-200 text-blue-900 font-medium px-0.5 rounded">
        {part}
      </span>
    ) : (
      part
    );
  });
};

/**
 * 법령 이름과 조항 제목을 강조하는 함수 (React 노드 반환)
 * @param text - 하이라이트할 텍스트 또는 React 노드
 * @returns React.ReactNode - 하이라이트된 텍스트
 */
export const highlightLawAndArticles = (text: string | React.ReactNode): React.ReactNode => {
  // 문자열로 변환
  let textString = '';
  if (typeof text === 'string') {
    textString = text;
  } else if (React.isValidElement(text)) {
    // React 요소인 경우 텍스트 추출 (간단한 경우만)
    textString = String(text);
  } else if (Array.isArray(text)) {
    textString = text.map(node => typeof node === 'string' ? node : '').join('');
  }
  
  if (!textString) return text;
  
  // 법령 이름 패턴: "XXX법", "XXX시행령", "XXX시행규칙" 등 (줄 시작)
  const lawNamePattern = /(^|\n)([가-힣\s]+법|([가-힣\s]+시행령)|([가-힣\s]+시행규칙))(?=\s|$|\[)/m;
  
  // 조항 패턴: "제N조", "제N조의N", "제N조의N(제목)" 등
  const articlePattern = /(제\d+조(?:의\d+)?(?:\([^)]+\))?)/g;
  
  const parts: React.ReactNode[] = [];
  const matches: Array<{ type: 'law' | 'article'; index: number; length: number; text: string }> = [];
  
  // 법령 이름 찾기 (각 줄의 시작에서)
  const lines = textString.split('\n');
  let offset = 0;
  lines.forEach((line, lineIdx) => {
    const lawMatch = line.match(/^([가-힣\s]+법|([가-힣\s]+시행령)|([가-힣\s]+시행규칙))(?=\s|$|\[)/);
    if (lawMatch && lawMatch[0]) {
      matches.push({
        type: 'law',
        index: offset + line.indexOf(lawMatch[0]),
        length: lawMatch[0].length,
        text: lawMatch[0]
      });
    }
    offset += line.length + 1; // +1 for newline
  });
  
  // 조항 찾기
  let match;
  while ((match = articlePattern.exec(textString)) !== null) {
    if (match.index !== undefined && match[0]) {
      matches.push({
        type: 'article',
        index: match.index,
        length: match[0].length,
        text: match[0]
      });
    }
  }
  
  // 인덱스 순으로 정렬
  matches.sort((a, b) => a.index - b.index);
  
  // 겹치는 부분 제거
  const processedMatches: typeof matches = [];
  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const prev = processedMatches[processedMatches.length - 1];
    
    if (!prev || current.index >= prev.index + prev.length) {
      processedMatches.push(current);
    }
  }
  
  // 텍스트 분할 및 하이라이트
  let currentIndex = 0;
  processedMatches.forEach((matchItem, idx) => {
    const { index, length, text: matchedText, type } = matchItem;
    
    // 매치 전 텍스트 추가
    if (index > currentIndex) {
      const beforeText = textString.substring(currentIndex, index);
      if (beforeText) {
        parts.push(<React.Fragment key={`before-${idx}`}>{beforeText}</React.Fragment>);
      }
    }
    
    // 매치된 부분 하이라이트
    parts.push(
      <span key={`${type}-${idx}`} className="text-blue-600 font-bold text-base">
        {matchedText}
      </span>
    );
    
    currentIndex = index + length;
  });
  
  // 남은 텍스트 추가
  if (currentIndex < textString.length) {
    const remainingText = textString.substring(currentIndex);
    if (remainingText) {
      parts.push(<React.Fragment key="remaining">{remainingText}</React.Fragment>);
    }
  }
  
  // 매치가 없으면 원본 반환
  return parts.length > 0 ? <>{parts}</> : text;
};

/**
 * 공백 정규화 함수: 명확한 문단/항목 구분만 유지, 나머지는 공백으로
 * @param text - 정규화할 텍스트
 * @returns string - 정규화된 텍스트
 */
export const normalizeWhitespace = (text: string): string => {
  if (!text) return text;
  
  // 각 줄 내부의 공백과 탭 정규화
  const lines = text.split('\n').map(line => line.replace(/[ \t]+/g, ' ').trim());
  
  const result: string[] = [];
  let currentParagraph = ''; // 현재 누적 중인 문단
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const nextLine = lines[i + 1];
    
    // 1. 빈 줄은 문단 구분으로 처리
    if (line === '') {
      // 누적된 문단이 있으면 저장
      if (currentParagraph) {
        result.push(currentParagraph.trim());
        currentParagraph = '';
      }
      result.push(''); // 빈 줄 유지
      continue;
    }
    
    // 2. 명확한 새 항목 패턴이면 줄바꿈 유지
    // 숫자, 한자 숫자, 불릿(•, ·), 하이픈(-), 제목(■, ○), 질문(Q.), "제N조" 패턴, 번호(1), 2) 등
    const isNewItem = /^[\d①②③④⑤⑥⑦⑧⑨⑩·\-\•■○]/.test(line) || 
                     /^제\d+[의조항호의]/.test(line) ||              // 제6조의3, 제1항, 제6의2호 등
                     /^\d+[\.\）\)]/.test(line) ||                    // 1., 2), 1) 등
                     /^\d+의\d+\./.test(line) ||                     // 6의2., 1의1. 등
                     /^[가-힣]\./.test(line) ||                       // 가., 나., 다. 등 (한글 항목)
                     /^-{4,}\.?/.test(line) ||                        // 구분선: ---- 이상
                     /^Q\./.test(line) ||                             // Q. 질문
                     /^[A-Z가-힣]{2,}\s*$/.test(line);                 // 제목(2글자 이상 한글/영문만)
    
    // 3. 현재 줄이 새 항목이면 줄바꿈 유지
    if (isNewItem) {
      // 누적된 문단이 있으면 저장
      if (currentParagraph) {
        result.push(currentParagraph.trim());
        currentParagraph = '';
      }
      result.push(line);
      continue;
    }
    
    // 4. 다음 줄이 없거나 빈 줄이면 줄바꿈 유지
    if (!nextLine || nextLine === '') {
      currentParagraph += (currentParagraph ? ' ' : '') + line;
      result.push(currentParagraph.trim());
      currentParagraph = '';
      continue;
    }
    
    // 5. 다음 줄이 새 항목이면 줄바꿈 유지
    const nextIsNewItem = /^[\d①②③④⑤⑥⑦⑧⑨⑩·\-\•■○]/.test(nextLine) ||
                          /^제\d+[의조항호의]/.test(nextLine) ||              // 제6조의3, 제1항, 제6의2호 등
                          /^\d+[\.\）\)]/.test(nextLine) ||                    // 1., 2), 1) 등
                          /^\d+의\d+\./.test(nextLine) ||                     // 6의2., 1의1. 등
                          /^[가-힣]\./.test(nextLine) ||                       // 가., 나., 다. 등 (한글 항목)
                          /^-{4,}\.?/.test(nextLine) ||                        // 구분선: ---- 이상
                          /^Q\./.test(nextLine) ||                             // Q. 질문
                          /^[A-Z가-힣]{2,}\s*$/.test(nextLine);                 // 제목(2글자 이상 한글/영문만)
    
    if (nextIsNewItem) {
      currentParagraph += (currentParagraph ? ' ' : '') + line;
      result.push(currentParagraph.trim());
      currentParagraph = '';
      continue;
    }
    
    // 6. 그 외는 공백으로 연결 (현재 문단에 누적)
    currentParagraph += (currentParagraph ? ' ' : '') + line;
  }
  
  // 마지막 누적된 문단이 있으면 추가
  if (currentParagraph) {
    result.push(currentParagraph.trim());
  }
  
  return result.join('\n');
};

