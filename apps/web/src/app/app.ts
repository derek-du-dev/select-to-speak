import { CommonModule } from '@angular/common';
import { Component, OnDestroy, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

type AppMode = 'compose' | 'listen';
type LoadState = 'idle' | 'splitting' | 'ready' | 'error';
type AudioStatus = 'pending' | 'loading' | 'loaded' | 'error';

interface AudioCacheEntry {
  objectUrl: string | null;
  status: AudioStatus;
}

@Component({
  selector: 'app-root',
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnDestroy {
  protected readonly inputText = signal('');
  protected readonly sentences = signal<string[]>([]);
  protected readonly activeIndex = signal(0);
  protected readonly mode = signal<AppMode>('compose');
  protected readonly loadState = signal<LoadState>('idle');
  protected readonly errorMessage = signal('');
  protected readonly loopCurrent = signal(false);
  protected readonly isPlaying = signal(false);
  protected readonly isBuffering = signal(false);
  protected readonly currentTime = signal(0);
  protected readonly duration = signal(0);
  protected readonly audioCache = signal<Record<number, AudioCacheEntry>>({});
  protected readonly selectionAudioCache = signal<Record<string, AudioCacheEntry>>({});
  protected readonly selectedText = signal('');
  protected readonly isSelectionAudioLoading = signal(false);
  protected readonly isSelectionAudioPlaying = signal(false);
  protected readonly initialPreloaded = signal(0);
  protected readonly initialPreloadTotal = signal(0);

  protected readonly apiUrl = 'http://localhost:18002';
  protected readonly voice = 'en-US-AvaNeural';
  protected readonly rate = '+0%';

  private activeAudio: HTMLAudioElement | null = null;
  private activeSelectionAudio: HTMLAudioElement | null = null;
  private playbackToken = 0;

  protected readonly activeSentence = computed(() => this.sentences()[this.activeIndex()] ?? '');
  protected readonly progressPercent = computed(() => {
    const duration = this.duration();
    return duration > 0 ? Math.min(100, (this.currentTime() / duration) * 100) : 0;
  });
  protected readonly sentenceIndicator = computed(() => {
    const total = this.sentences().length;
    return total ? `第 ${this.activeIndex() + 1} / ${total} 句` : '第 0 / 0 句';
  });
  protected readonly preloadPercent = computed(() => {
    const total = this.initialPreloadTotal();
    return total > 0 ? (this.initialPreloaded() / total) * 100 : 0;
  });
  protected readonly displayVoice = computed(() => this.voice.replace('en-US-', '').replace('Neural', ''));

  ngOnDestroy(): void {
    this.stopAudio();
    this.stopSelectionAudio();
    Object.values(this.audioCache()).forEach((entry) => {
      if (entry.objectUrl) {
        URL.revokeObjectURL(entry.objectUrl);
      }
    });
    Object.values(this.selectionAudioCache()).forEach((entry) => {
      if (entry.objectUrl) {
        URL.revokeObjectURL(entry.objectUrl);
      }
    });
  }

  protected async startIntensiveListening(): Promise<void> {
    const text = this.inputText().trim();

    if (!text) {
      return;
    }

    this.resetListeningState();
    this.mode.set('listen');
    this.loadState.set('splitting');

    try {
      const response = await fetch(`${this.apiUrl}/api/split-sentences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json() as { sentences?: string[] };
      const sentences = data.sentences?.map((sentence) => sentence.trim()).filter(Boolean) ?? [];

      if (!sentences.length) {
        throw new Error('No sentences found in the submitted text.');
      }

      this.sentences.set(sentences);
      this.loadState.set('ready');
      await this.preloadInitialSentences();
      this.playSentence(0);
      void this.preloadRemainingSentences();
    } catch (error) {
      this.loadState.set('error');
      this.errorMessage.set(error instanceof Error ? error.message : 'Unknown API error');
    }
  }

  protected backToCompose(): void {
    this.stopAudio();
    this.stopSelectionAudio();
    this.mode.set('compose');
  }

  protected retry(): void {
    void this.startIntensiveListening();
  }

  protected async selectSentence(index: number): Promise<void> {
    await this.playSentence(index);
  }

  protected keepSelectableTextClick(event: Event): void {
    event.stopPropagation();
  }

  protected captureSelectedText(event: Event): void {
    event.stopPropagation();

    const selection = window.getSelection()?.toString().trim() ?? '';
    this.selectedText.set(selection);
  }

  protected async playSelectedText(event: Event): Promise<void> {
    event.stopPropagation();

    const text = this.selectedText().trim();
    if (!text) {
      return;
    }

    this.stopAudio();
    this.stopSelectionAudio();
    this.isSelectionAudioLoading.set(true);

    try {
      const objectUrl = await this.fetchSelectionAudioObjectUrl(text);
      const audio = new Audio(objectUrl);
      this.activeSelectionAudio = audio;

      audio.addEventListener('playing', () => {
        this.isSelectionAudioLoading.set(false);
        this.isSelectionAudioPlaying.set(true);
      });
      audio.addEventListener('pause', () => this.isSelectionAudioPlaying.set(false));
      audio.addEventListener('ended', () => this.isSelectionAudioPlaying.set(false));
      audio.addEventListener('error', () => {
        this.isSelectionAudioLoading.set(false);
        this.isSelectionAudioPlaying.set(false);
      });

      await audio.play();
    } catch {
      this.isSelectionAudioLoading.set(false);
      this.isSelectionAudioPlaying.set(false);
    }
  }

  protected togglePlayback(): void {
    if (!this.activeAudio) {
      void this.playSentence(this.activeIndex());
      return;
    }

    if (this.activeAudio.paused) {
      void this.activeAudio.play();
    } else {
      this.activeAudio.pause();
    }
  }

  protected previousSentence(): void {
    if (this.activeIndex() > 0) {
      void this.playSentence(this.activeIndex() - 1);
    }
  }

  protected nextSentence(): void {
    if (this.activeIndex() < this.sentences().length - 1) {
      void this.playSentence(this.activeIndex() + 1);
    }
  }

  protected replayCurrent(): void {
    if (!this.activeAudio) {
      void this.playSentence(this.activeIndex());
      return;
    }

    this.activeAudio.currentTime = 0;
    void this.activeAudio.play();
  }

  protected seek(event: MouseEvent): void {
    if (!this.activeAudio || !this.duration()) {
      return;
    }

    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const clickRatio = (event.clientX - rect.left) / rect.width;
    this.activeAudio.currentTime = this.duration() * Math.min(1, Math.max(0, clickRatio));
  }

  protected audioStatus(index: number): AudioStatus {
    return this.audioCache()[index]?.status ?? 'pending';
  }

  protected formatTime(seconds: number): string {
    if (!Number.isFinite(seconds)) {
      return '0:00';
    }

    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }

  private resetListeningState(): void {
    this.stopAudio();
    this.stopSelectionAudio();
    Object.values(this.audioCache()).forEach((entry) => {
      if (entry.objectUrl) {
        URL.revokeObjectURL(entry.objectUrl);
      }
    });
    Object.values(this.selectionAudioCache()).forEach((entry) => {
      if (entry.objectUrl) {
        URL.revokeObjectURL(entry.objectUrl);
      }
    });
    this.sentences.set([]);
    this.audioCache.set({});
    this.selectionAudioCache.set({});
    this.selectedText.set('');
    this.activeIndex.set(0);
    this.currentTime.set(0);
    this.duration.set(0);
    this.initialPreloaded.set(0);
    this.initialPreloadTotal.set(0);
    this.errorMessage.set('');
  }

  private async preloadInitialSentences(): Promise<void> {
    const total = Math.min(5, this.sentences().length);
    this.initialPreloadTotal.set(total);
    this.initialPreloaded.set(0);

    const preloadTasks = Array.from({ length: total }, (_, index) =>
      this.preloadSentence(index).catch(() => null).finally(() => {
        this.initialPreloaded.update((count) => count + 1);
      })
    );

    await Promise.all(preloadTasks);
  }

  private async preloadRemainingSentences(): Promise<void> {
    for (let index = this.initialPreloadTotal(); index < this.sentences().length; index++) {
      if (this.mode() !== 'listen') {
        return;
      }

      await this.preloadSentence(index).catch(() => null);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  private async preloadSentence(index: number): Promise<string> {
    const existing = this.audioCache()[index];
    if (existing?.status === 'loaded' && existing.objectUrl) {
      return existing.objectUrl;
    }

    this.setAudioCache(index, { objectUrl: null, status: 'loading' });

    try {
      const response = await fetch(this.buildTtsUrl(this.sentences()[index]));

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const objectUrl = URL.createObjectURL(await response.blob());
      this.setAudioCache(index, { objectUrl, status: 'loaded' });
      return objectUrl;
    } catch (error) {
      this.setAudioCache(index, { objectUrl: null, status: 'error' });
      throw error;
    }
  }

  private async fetchSelectionAudioObjectUrl(text: string): Promise<string> {
    const cacheKey = this.selectionCacheKey(text);
    const existing = this.selectionAudioCache()[cacheKey];

    if (existing?.status === 'loaded' && existing.objectUrl) {
      return existing.objectUrl;
    }

    this.setSelectionAudioCache(cacheKey, { objectUrl: null, status: 'loading' });

    try {
      const response = await fetch(this.buildTtsUrl(text));

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const objectUrl = URL.createObjectURL(await response.blob());
      this.setSelectionAudioCache(cacheKey, { objectUrl, status: 'loaded' });
      return objectUrl;
    } catch (error) {
      this.setSelectionAudioCache(cacheKey, { objectUrl: null, status: 'error' });
      throw error;
    }
  }

  private async playSentence(index: number): Promise<void> {
    if (index < 0 || index >= this.sentences().length) {
      return;
    }

    const token = ++this.playbackToken;
    this.stopAudio(false);
    this.activeIndex.set(index);
    this.selectedText.set('');
    this.currentTime.set(0);
    this.duration.set(0);
    this.isBuffering.set(true);
    this.scrollActiveSentenceIntoView();

    try {
      const objectUrl = await this.preloadSentence(index);

      if (token !== this.playbackToken) {
        return;
      }

      const audio = new Audio(objectUrl);
      this.activeAudio = audio;
      this.bindAudioEvents(audio, index);
      await audio.play();
    } catch {
      if (token === this.playbackToken) {
        this.isBuffering.set(false);
        this.isPlaying.set(false);
      }
    }
  }

  private bindAudioEvents(audio: HTMLAudioElement, index: number): void {
    audio.addEventListener('loadstart', () => this.isBuffering.set(true));
    audio.addEventListener('waiting', () => this.isBuffering.set(true));
    audio.addEventListener('canplaythrough', () => this.isBuffering.set(false));
    audio.addEventListener('playing', () => {
      this.isBuffering.set(false);
      this.isPlaying.set(true);
    });
    audio.addEventListener('pause', () => {
      this.isBuffering.set(false);
      this.isPlaying.set(false);
    });
    audio.addEventListener('timeupdate', () => {
      this.currentTime.set(audio.currentTime);
      this.duration.set(audio.duration || 0);
    });
    audio.addEventListener('loadedmetadata', () => this.duration.set(audio.duration || 0));
    audio.addEventListener('ended', () => {
      this.isPlaying.set(false);
      this.currentTime.set(0);

      if (this.loopCurrent()) {
        audio.currentTime = 0;
        void audio.play();
        return;
      }

      if (index + 1 < this.sentences().length) {
        setTimeout(() => void this.playSentence(index + 1), 100);
      }
    });
    audio.addEventListener('error', () => {
      this.isBuffering.set(false);
      this.isPlaying.set(false);
    });
  }

  private stopAudio(invalidatePlayback = true): void {
    if (invalidatePlayback) {
      this.playbackToken++;
    }

    if (this.activeAudio) {
      this.activeAudio.pause();
      this.activeAudio.src = '';
      this.activeAudio = null;
    }

    this.isPlaying.set(false);
    this.isBuffering.set(false);
  }

  private stopSelectionAudio(): void {
    if (this.activeSelectionAudio) {
      this.activeSelectionAudio.pause();
      this.activeSelectionAudio.src = '';
      this.activeSelectionAudio = null;
    }

    this.isSelectionAudioPlaying.set(false);
  }

  private setAudioCache(index: number, entry: AudioCacheEntry): void {
    this.audioCache.update((cache) => ({ ...cache, [index]: entry }));
  }

  private setSelectionAudioCache(cacheKey: string, entry: AudioCacheEntry): void {
    this.selectionAudioCache.update((cache) => ({ ...cache, [cacheKey]: entry }));
  }

  private selectionCacheKey(text: string): string {
    return JSON.stringify({
      text,
      apiUrl: this.apiUrl,
      rate: this.rate,
      voice: this.voice
    });
  }

  private buildTtsUrl(text: string): string {
    const params = new URLSearchParams({
      text,
      rate: this.rate,
      voice: this.voice
    });

    return `${this.apiUrl}/api/tts?${params.toString()}`;
  }

  private scrollActiveSentenceIntoView(): void {
    setTimeout(() => {
      const activeElement = document.getElementById(`sentence-item-${this.activeIndex()}`);
      if (!activeElement?.scrollIntoView) {
        return;
      }

      activeElement.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
    });
  }
}
