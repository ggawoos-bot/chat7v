/**
 * Node.js 환경에서 브라우저 객체들을 polyfill하는 스크립트
 * pdf-parse 라이브러리가 Node.js에서 작동하도록 도움
 */

// JSDOM을 사용하여 브라우저 환경 시뮬레이션
import { JSDOM } from 'jsdom';

// DOM 객체들을 전역으로 설정
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'http://localhost',
  pretendToBeVisual: true,
  resources: 'usable'
});

// 전역 객체들 설정
global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;

// DOMMatrix polyfill
if (!global.DOMMatrix) {
  global.DOMMatrix = class DOMMatrix {
    constructor(init) {
      if (init) {
        this.a = init.a || 1;
        this.b = init.b || 0;
        this.c = init.c || 0;
        this.d = init.d || 1;
        this.e = init.e || 0;
        this.f = init.f || 0;
      } else {
        this.a = 1;
        this.b = 0;
        this.c = 0;
        this.d = 1;
        this.e = 0;
        this.f = 0;
      }
    }
    
    scale(scaleX, scaleY = scaleX) {
      return new DOMMatrix({
        a: this.a * scaleX,
        b: this.b * scaleX,
        c: this.c * scaleY,
        d: this.d * scaleY,
        e: this.e,
        f: this.f
      });
    }
    
    translate(tx, ty) {
      return new DOMMatrix({
        a: this.a,
        b: this.b,
        c: this.c,
        d: this.d,
        e: this.e + tx,
        f: this.f + ty
      });
    }
  };
}

// ImageData polyfill
if (!global.ImageData) {
  global.ImageData = class ImageData {
    constructor(data, width, height) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  };
}

// Path2D polyfill
if (!global.Path2D) {
  global.Path2D = class Path2D {
    constructor(path) {
      this.commands = [];
      if (path) {
        // 간단한 Path2D 구현
        this.commands.push(path);
      }
    }
    
    moveTo(x, y) {
      this.commands.push(['moveTo', x, y]);
    }
    
    lineTo(x, y) {
      this.commands.push(['lineTo', x, y]);
    }
    
    closePath() {
      this.commands.push(['closePath']);
    }
  };
}

// Canvas polyfill (기본적인 구현)
if (!global.HTMLCanvasElement) {
  global.HTMLCanvasElement = class HTMLCanvasElement {
    constructor() {
      this.width = 0;
      this.height = 0;
    }
    
    getContext(type) {
      if (type === '2d') {
        return {
          createImageData: (width, height) => new ImageData(new Uint8ClampedArray(width * height * 4), width, height),
          getImageData: () => new ImageData(new Uint8ClampedArray(4), 1, 1),
          putImageData: () => {},
          drawImage: () => {},
          fillRect: () => {},
          clearRect: () => {},
          strokeRect: () => {},
          beginPath: () => {},
          closePath: () => {},
          moveTo: () => {},
          lineTo: () => {},
          arc: () => {},
          fill: () => {},
          stroke: () => {},
          save: () => {},
          restore: () => {},
          translate: () => {},
          scale: () => {},
          rotate: () => {},
          setTransform: () => {},
          transform: () => {}
        };
      }
      return null;
    }
  };
}

console.log('Node.js 환경 polyfill 설정 완료');
