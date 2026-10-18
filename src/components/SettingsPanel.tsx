// Right panel: playback, pitch, sound & volume, cue sounds, voice, display & comfort
import { useEffect, useState } from 'react';
import { useStore, type AppState, type PlaybackMode, type ThemeId } from '../state/store';
import { useActions } from '../app/actions';
import { speech } from '../app/speech';
import { setLocale, t, tl, type Locale } from '../i18n';
import { SCALE_LABELS, type ScaleId } from '../audio/ScaleQuantizer';
import { WAVEFORM_LABELS, type Waveform } from '../audio/AudioEngine';
import { CUE_LABELS, type CueType } from '../audio/CueSoundEngine';
import { midiToNoteName } from '../app/describe';

const SPEED_PRESETS: { label: string; value: number }[] = [
  { label: 'Very slow 🐢', value: 0.35 },
  { label: 'Slow', value: 0.6 },
  { label: 'Normal', value: 1 },
  { label: 'Fast', value: 1.6 },
  { label: 'Very fast 🐇', value: 2.4 },
];

const CUE_PREVIEW_ORDER: CueType[] = [
  'start',
  'end',
  'vertex',
  'intersection',
  'closure',
  'error',
  'correct',
  'wrong',
];

export default function SettingsPanel() {
  const { state, dispatch } = useStore();
  const actions = useActions();

  const patch = (p: Partial<AppState>) => dispatch({ type: 'patch', patch: p });

  return (
    <aside className="panel panel-right" aria-label="Sound and playback settings">
      <h2>
        <span aria-hidden="true">🎛️ </span>
        {t('Settings')}
      </h2>

      <fieldset className="settings-group">
        <legend>
          <span aria-hidden="true">🌐 </span>Language / 语言
        </legend>
        <div className="settings-row" role="radiogroup" aria-label="Interface language 界面语言">
          {(
            [
              ['en', 'English'],
              ['zh', '中文'],
            ] as [Locale, string][]
          ).map(([loc, label]) => (
            <label key={loc} style={{ marginRight: '0.6rem' }}>
              <input
                type="radio"
                name="ui-language"
                checked={state.locale === loc}
                onChange={() => {
                  setLocale(loc); // before re-render so t() picks it up immediately
                  patch({ locale: loc });
                  actions.announce(loc === 'zh' ? '已切换到中文界面' : 'Switched to English');
                }}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="settings-group">
        <legend>
          <span aria-hidden="true">🎚️ </span>{t('Playback')}
        </legend>
        <div className="settings-row" role="radiogroup" aria-label="Playback mode">
          <span>{t('Mode')}</span>
          <span>
            {(
              [
                ['continuous', t('Whole')],
                ['segment', t('Edges')],
                ['exploration', t('Explore')],
              ] as [PlaybackMode, string][]
            ).map(([mode, label]) => (
              <label key={mode} style={{ marginRight: '0.5rem' }}>
                <input
                  type="radio"
                  name="playback-mode"
                  checked={state.playbackMode === mode}
                  onChange={() => actions.setMode(mode)}
                />
                {label}
              </label>
            ))}
          </span>
        </div>
        <div className="settings-row">
          <label htmlFor="speed-preset">{t('Playback speed')}</label>
          <select
            id="speed-preset"
            value={String(
              SPEED_PRESETS.find((p) => Math.abs(p.value - state.playbackSpeed) < 0.01)?.value ?? '',
            )}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (Number.isFinite(v)) patch({ playbackSpeed: v });
            }}
          >
            <option value="">{t('Custom')}</option>
            {SPEED_PRESETS.map((p) => (
              <option key={p.label} value={p.value}>
                {t(p.label)}
              </option>
            ))}
          </select>
        </div>
        <div className="settings-row">
          <label htmlFor="speed-slider">{t('Speed slider')}</label>
          <input
            id="speed-slider"
            type="range"
            min={0.25}
            max={3}
            step={0.05}
            value={state.playbackSpeed}
            aria-valuetext={`${state.playbackSpeed.toFixed(2)} times speed`}
            onChange={(e) => patch({ playbackSpeed: parseFloat(e.target.value) })}
          />
          <span aria-hidden="true">{state.playbackSpeed.toFixed(2)}x</span>
        </div>
        <div className="settings-row">
          <span>{t('Playback direction')}{t(' (closed shapes)')}</span>
          <span role="radiogroup" aria-label="Playback direction">
            <label style={{ marginRight: '0.5rem' }}>
              <input
                type="radio"
                name="play-direction"
                checked={state.playDirection === 'clockwise'}
                onChange={() => patch({ playDirection: 'clockwise' })}
              />
              {t('Clockwise')}
            </label>
            <label>
              <input
                type="radio"
                name="play-direction"
                checked={state.playDirection === 'counterclockwise'}
                onChange={() => patch({ playDirection: 'counterclockwise' })}
              />
              {t('Counterclockwise')}
            </label>
          </span>
        </div>
        <div className="settings-row">
          <label htmlFor="loop-toggle">{t('Loop playback')}</label>
          <input
            id="loop-toggle"
            type="checkbox"
            checked={state.loopEnabled}
            onChange={(e) => patch({ loopEnabled: e.target.checked })}
          />
        </div>
        <div className="settings-row">
          <label htmlFor="snap-toggle">{t('Line snap while exploring')}</label>
          <input
            id="snap-toggle"
            type="checkbox"
            checked={state.snapEnabled}
            onChange={(e) => patch({ snapEnabled: e.target.checked })}
          />
        </div>
      </fieldset>

      <fieldset className="settings-group">
        <legend>
          <span aria-hidden="true">🎹 </span>{t('Pitch')}
        </legend>
        <div className="settings-row">
          <label htmlFor="min-midi">{t('Lowest pitch')} (MIDI)</label>
          <input
            id="min-midi"
            type="number"
            min={24}
            max={96}
            value={state.minMidi}
            aria-describedby="min-midi-note"
            onChange={(e) => {
              const v = Math.round(Number(e.target.value));
              if (Number.isFinite(v) && v >= 24 && v < state.maxMidi) patch({ minMidi: v });
            }}
          />
          <span id="min-midi-note" className="settings-note">
            {midiToNoteName(state.minMidi)}
          </span>
        </div>
        <div className="settings-row">
          <label htmlFor="max-midi">{t('Highest pitch')} (MIDI)</label>
          <input
            id="max-midi"
            type="number"
            min={36}
            max={108}
            value={state.maxMidi}
            aria-describedby="max-midi-note"
            onChange={(e) => {
              const v = Math.round(Number(e.target.value));
              if (Number.isFinite(v) && v <= 108 && v > state.minMidi) patch({ maxMidi: v });
            }}
          />
          <span id="max-midi-note" className="settings-note">
            {midiToNoteName(state.maxMidi)}
          </span>
        </div>
        <div className="settings-row" role="radiogroup" aria-label="Pitch mode">
          <span>{t('Pitch style')}</span>
          <span>
            <label style={{ marginRight: '0.5rem' }}>
              <input
                type="radio"
                name="pitch-mode"
                checked={state.pitchMode === 'continuous'}
                onChange={() => patch({ pitchMode: 'continuous' })}
              />
              {t('Smooth pitch')}
            </label>
            <label>
              <input
                type="radio"
                name="pitch-mode"
                checked={state.pitchMode === 'quantized'}
                onChange={() => patch({ pitchMode: 'quantized' })}
              />
              {t('Musical scale pitch')}
            </label>
          </span>
        </div>
        <div className="settings-row">
          <label htmlFor="scale-select">{t('Scale')}</label>
          <select
            id="scale-select"
            value={state.selectedScale}
            disabled={state.pitchMode !== 'quantized'}
            onChange={(e) => patch({ selectedScale: e.target.value as ScaleId })}
          >
            {(Object.keys(SCALE_LABELS) as ScaleId[]).map((id) => (
              <option key={id} value={id}>
                {t(SCALE_LABELS[id])}
              </option>
            ))}
          </select>
        </div>
      </fieldset>

      <fieldset className="settings-group">
        <legend>
          <span aria-hidden="true">🔊 </span>{t('Sound & Volume')}
        </legend>
        <div className="settings-row">
          <label htmlFor="waveform-select">{t('Main sound')}</label>
          <select
            id="waveform-select"
            value={state.waveform}
            onChange={(e) => patch({ waveform: e.target.value as Waveform })}
          >
            {(Object.keys(WAVEFORM_LABELS) as Waveform[]).map((w) => (
              <option key={w} value={w}>
                {t(WAVEFORM_LABELS[w])}
              </option>
            ))}
          </select>
        </div>
        <div className="settings-row">
          <label htmlFor="master-volume">{t('Master volume')}</label>
          <input
            id="master-volume"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={state.masterVolume}
            aria-valuetext={`${Math.round(state.masterVolume * 100)}%`}
            onChange={(e) => patch({ masterVolume: parseFloat(e.target.value) })}
          />
        </div>
        <div className="settings-row">
          <label htmlFor="main-volume">{t('Main volume')}</label>
          <input
            id="main-volume"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={state.mainVoiceVolume}
            aria-valuetext={`${Math.round(state.mainVoiceVolume * 100)}%`}
            onChange={(e) => patch({ mainVoiceVolume: parseFloat(e.target.value) })}
          />
        </div>
        <div className="settings-row">
          <label htmlFor="cue-volume">{t('Cue volume')}</label>
          <input
            id="cue-volume"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={state.cueVolume}
            aria-valuetext={`${Math.round(state.cueVolume * 100)}%`}
            onChange={(e) => patch({ cueVolume: parseFloat(e.target.value) })}
          />
        </div>
      </fieldset>

      <fieldset className="settings-group">
        <legend>
          <span aria-hidden="true">🔔 </span>{t('Cue Sounds')}
        </legend>
        <div className="settings-row">
          <label htmlFor="vertex-cue">{t('Corner sounds')}</label>
          <input
            id="vertex-cue"
            type="checkbox"
            checked={state.vertexCueEnabled}
            onChange={(e) => patch({ vertexCueEnabled: e.target.checked })}
          />
        </div>
        <div className="settings-row">
          <label htmlFor="vertex-pause">{t('Corner pause')}</label>
          <input
            id="vertex-pause"
            type="range"
            min={0}
            max={500}
            step={10}
            value={state.vertexPauseMs}
            aria-valuetext={`${state.vertexPauseMs} milliseconds`}
            onChange={(e) => patch({ vertexPauseMs: Number(e.target.value) })}
          />
          <span aria-hidden="true">{state.vertexPauseMs}ms</span>
        </div>
        <div className="settings-row">
          <label htmlFor="intersection-cue">{t('Crossing sounds')}</label>
          <input
            id="intersection-cue"
            type="checkbox"
            checked={state.intersectionCueEnabled}
            onChange={(e) => patch({ intersectionCueEnabled: e.target.checked })}
          />
        </div>
        <div className="settings-row">
          <label htmlFor="closure-cue">{t('Closing chime')}</label>
          <input
            id="closure-cue"
            type="checkbox"
            checked={state.closureCueEnabled}
            onChange={(e) => patch({ closureCueEnabled: e.target.checked })}
          />
        </div>
        <p className="settings-note">{t('Tap to hear each sound:')}</p>
        <div className="cue-preview-grid">
          {CUE_PREVIEW_ORDER.map((cue) => (
            <button key={cue} onClick={() => actions.previewCue(cue)}>
              {t(CUE_LABELS[cue])}
            </button>
          ))}
        </div>
      </fieldset>

      <VoiceAssistanceGroup
        speechEnabled={state.speechEnabled}
        speechVoiceURI={state.speechVoiceURI}
        speechRate={state.speechRate}
        speakFocus={state.speakFocus}
        patch={patch}
      />

      <fieldset className="settings-group">
        <legend>
          <span aria-hidden="true">🎨 </span>{t('Display & Comfort')}
        </legend>
        <div className="settings-row">
          <label htmlFor="theme-select">{t('Theme')}</label>
          <select
            id="theme-select"
            value={state.theme}
            onChange={(e) => patch({ theme: e.target.value as ThemeId })}
          >
            <option value="light">{t('Warm light')}</option>
            <option value="dark">{t('Cozy dark')}</option>
            <option value="contrast">{t('High contrast')}</option>
          </select>
        </div>
        <div className="settings-row">
          <label htmlFor="font-scale">{t('Text size')}</label>
          <select
            id="font-scale"
            value={String(state.fontScale)}
            onChange={(e) => patch({ fontScale: parseFloat(e.target.value) })}
          >
            <option value="0.9">{t('Small')}</option>
            <option value="1">{t('Standard')}</option>
            <option value="1.2">{t('Large')}</option>
            <option value="1.4">{t('Extra large')}</option>
          </select>
        </div>
        <div className="settings-row">
          <label htmlFor="line-width">{t('Line thickness')}</label>
          <input
            id="line-width"
            type="range"
            min={1}
            max={6}
            step={0.5}
            value={state.lineWidth}
            aria-valuetext={`Thickness ${state.lineWidth}`}
            onChange={(e) => patch({ lineWidth: parseFloat(e.target.value) })}
          />
        </div>
        <div className="settings-row">
          <label htmlFor="hide-visuals">{t('Hide the visual display')}</label>
          <input
            id="hide-visuals"
            type="checkbox"
            checked={state.hideVisuals}
            onChange={(e) => patch({ hideVisuals: e.target.checked })}
          />
        </div>
      </fieldset>

      <fieldset className="settings-group">
        <legend>
          <span aria-hidden="true">🎧 </span>{t('Audio Output')}
        </legend>
        <p className="settings-note">
          {t(
            "This app uses your system's default audio output. Headphones are strongly recommended so left and right sounds are easy to tell apart. To switch devices, use your operating system's sound settings.",
          )}
        </p>
      </fieldset>
    </aside>
  );
}

interface VoiceGroupProps {
  speechEnabled: boolean;
  speechVoiceURI: string | null;
  speechRate: number;
  speakFocus: boolean;
  patch: (p: Partial<AppState>) => void;
}

function VoiceAssistanceGroup({
  speechEnabled,
  speechVoiceURI,
  speechRate,
  speakFocus,
  patch,
}: VoiceGroupProps) {
  const [voices, setVoices] = useState(() => speech.listVoices());

  // Voices load asynchronously in some engines
  useEffect(() => {
    const unsub = speech.onVoicesChanged(() => setVoices(speech.listVoices()));
    const timer = setTimeout(() => setVoices(speech.listVoices()), 800);
    return () => {
      unsub();
      clearTimeout(timer);
    };
  }, []);

  return (
    <fieldset className="settings-group">
      <legend>
        <span aria-hidden="true">🗣️ </span>{t('Voice Assistance')}
      </legend>
      <div className="settings-row">
        <label htmlFor="speech-toggle">{t('Spoken announcements')}</label>
        <input
          id="speech-toggle"
          type="checkbox"
          checked={speechEnabled}
          onChange={(e) => patch({ speechEnabled: e.target.checked })}
        />
      </div>
      <div className="settings-row">
        <label htmlFor="speak-focus">{t('Speak focused controls')}</label>
        <input
          id="speak-focus"
          type="checkbox"
          checked={speakFocus}
          disabled={!speechEnabled}
          onChange={(e) => patch({ speakFocus: e.target.checked })}
        />
      </div>
      <div className="settings-row">
        <label htmlFor="voice-select">{t('Voice')}</label>
        <select
          id="voice-select"
          value={speechVoiceURI ?? 'auto'}
          onChange={(e) =>
            patch({ speechVoiceURI: e.target.value === 'auto' ? null : e.target.value })
          }
        >
          <option value="auto">{t('Auto — best available')}</option>
          {voices.map((v) => (
            <option key={v.voiceURI} value={v.voiceURI}>
              {v.name} ({v.lang})
            </option>
          ))}
        </select>
      </div>
      <div className="settings-row">
        <label htmlFor="speech-rate">{t('Speaking speed')}</label>
        <input
          id="speech-rate"
          type="range"
          min={0.5}
          max={3}
          step={0.05}
          value={speechRate}
          aria-valuetext={`${speechRate.toFixed(2)} times speed`}
          onChange={(e) => patch({ speechRate: parseFloat(e.target.value) })}
        />
        <span aria-hidden="true">{speechRate.toFixed(2)}x</span>
      </div>
      <button
        onClick={() =>
          void speech.speak(
            tl(
              'Hi there! This is my voice. Shall we listen to some shapes together?',
              '你好呀！这是我的声音。我们一起来听图形吧！',
            ),
          )
        }
      >
        <span aria-hidden="true">🔊 </span>{t('Test Voice')}
      </button>
      <p className="settings-note">
        {t(
          'For the most natural voice, download an Enhanced or Premium voice on your Mac: System Settings → Accessibility → Spoken Content → System Voice → Manage Voices (for example “Ava (Premium)”, “Samantha (Enhanced)”, or the Chinese voice “Tingting”). New voices appear in the list above automatically. If you use the VoiceOver screen reader, turn off “Speak focused controls” to avoid double speech.',
        )}
      </p>
    </fieldset>
  );
}
