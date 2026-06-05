import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.includes('/api/split-sentences')) {
        return Promise.resolve(new Response(JSON.stringify({
          sentences: ['This is the first sentence.', 'This is the second sentence.']
        })));
      }

      return Promise.resolve(new Response(new Blob(['mp3'], { type: 'audio/mpeg' })));
    }));
    vi.stubGlobal('Audio', class {
      currentTime = 0;
      duration = 4;
      paused = true;
      src = '';

      addEventListener(): void {}
      pause(): void {
        this.paused = true;
      }
      play(): Promise<void> {
        this.paused = false;
        return Promise.resolve();
      }
    });
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:tts'),
      revokeObjectURL: vi.fn()
    });

    await TestBed.configureTestingModule({
      imports: [App],
    }).compileComponents();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render the compose screen', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('精听练习');
    expect(compiled.querySelector('textarea')).toBeTruthy();
  });

  it('should switch to intensive listening after text is submitted', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const textarea = compiled.querySelector('textarea') as HTMLTextAreaElement;
    const button = compiled.querySelector('.primary-action') as HTMLButtonElement;

    textarea.value = 'This is the first sentence. This is the second sentence.';
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    button.click();
    await new Promise((resolve) => setTimeout(resolve));
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(compiled.querySelector('.drawer-header h2')?.textContent).toContain('英语精听模式');
    expect(compiled.querySelector('.active-selectable-text')?.textContent).toContain('This is the first sentence.');
  });

  it('should cache selected text audio after the first playback', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as unknown as {
      selectedText: { set: (value: string) => void };
      playSelectedText: (event: Event) => Promise<void>;
    };
    const fetchMock = vi.mocked(fetch);

    fetchMock.mockClear();
    app.selectedText.set('first sentence');

    await app.playSelectedText(new Event('click'));
    await app.playSelectedText(new Event('click'));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]?.toString()).toContain('/api/tts');
  });
});
