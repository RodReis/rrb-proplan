import { classifyKind } from './document-kind';

describe('classifyKind', () => {
  it('markdown/texto', () => {
    expect(classifyKind('docs/README.md')).toBe('markdown');
    expect(classifyKind('a.markdown')).toBe('markdown');
    expect(classifyKind('notes.txt')).toBe('markdown');
    expect(classifyKind('.github/workflows/ci.yml')).toBe('markdown');
    expect(classifyKind('x.yaml')).toBe('markdown');
  });
  it('pdf', () => expect(classifyKind('docs/spec.PDF')).toBe('pdf'));
  it('image', () => {
    expect(classifyKind('docs/logo.png')).toBe('image');
    expect(classifyKind('a.JPG')).toBe('image');
    expect(classifyKind('i.svg')).toBe('image');
    expect(classifyKind('w.webp')).toBe('image');
  });
  it('html', () => {
    expect(classifyKind('docs/report.html')).toBe('html');
    expect(classifyKind('r.htm')).toBe('html');
  });
  it('office (docx)', () => expect(classifyKind('docs/Requisito.docx')).toBe('office'));
  it('binary: xlsx, pptx, sem extensão, desconhecido', () => {
    expect(classifyKind('a.xlsx')).toBe('binary');
    expect(classifyKind('a.pptx')).toBe('binary');
    expect(classifyKind('LICENSE')).toBe('binary');
    expect(classifyKind('a.zip')).toBe('binary');
  });
});
