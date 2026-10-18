// Practice module: four listening stages with warm, encouraging feedback (bilingual)
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GeometryShape } from '../geometry/geometryTypes';
import { getLibraryShape } from '../geometry/shapeLibrary';
import { makePointShape, makeTwoLineShape } from '../app/adhocShapes';
import { useActions } from '../app/actions';
import { useStore } from '../state/store';
import { speakUnits } from '../app/describe';
import { t, tl } from '../i18n';
import { loadProgress, saveProgress, type LessonProgress } from '../state/persistence';

interface Question {
  prompt: string;
  shape: GeometryShape;
  options: string[];
  correctIndex: number;
  explanation: string;
}

const STAGES = [
  { id: 'stage1', name: 'Step 1 · Where Is the Sound?', emoji: '📍' },
  { id: 'stage2', name: 'Step 2 · Meet the Lines', emoji: '📏' },
  { id: 'stage3', name: 'Step 3 · Whole Shapes', emoji: '🔷' },
  { id: 'stage4', name: 'Step 4 · Shape Friendships', emoji: '🤝' },
];

function praiseList(): string[] {
  return [
    tl('You got it! 🎉', '答对啦！🎉'),
    tl('Wonderful ears! 🌟', '耳朵真灵！🌟'),
    tl('Exactly right! 👏', '完全正确！👏'),
    tl('Brilliant listening! 🎵', '听力大师！🎵'),
  ];
}

function encourageList(): string[] {
  return [
    tl('Not quite — great try, though!', '不太对——不过你已经很努力了！'),
    tl('Almost! Listening takes practice.', '就差一点！多听几次就会啦。'),
    tl('Good effort! Let’s listen again together.', '很棒的尝试！我们再一起听一遍。'),
  ];
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function libShape(id: string): GeometryShape {
  const s = getLibraryShape(id);
  if (!s) throw new Error(`Shape library is missing ${id}`);
  return s;
}

// ---------- Question generators ----------

function genStage1(): Question {
  const positions = [0.15, 0.5, 0.85];
  const kind = pick(['horizontal', 'vertical', 'quadrant'] as const);
  if (kind === 'horizontal') {
    const x = pick(positions);
    const y = pick(positions);
    const correct = x < 0.34 ? 0 : x > 0.66 ? 2 : 1;
    return {
      prompt: tl(
        'Listen to where the sound sits: is this point on the left, in the middle, or on the right?',
        '听声音在哪里：这个点在左边、中间还是右边？',
      ),
      shape: makePointShape(`q1h-${Date.now()}`, tl('Mystery point', '神秘点'), x, y),
      options: [tl('On the left', '在左边'), tl('In the middle', '在中间'), tl('On the right', '在右边')],
      correctIndex: correct,
      explanation: tl(
        `This point’s x coordinate is ${speakUnits(x)}, so the sound sits ${
          correct === 0 ? 'in your left ear' : correct === 2 ? 'in your right ear' : 'right in the middle'
        }.`,
        `这个点的横坐标是 ${speakUnits(x)}，所以声音${
          correct === 0 ? '在你的左耳' : correct === 2 ? '在你的右耳' : '正好在中间'
        }。`,
      ),
    };
  }
  if (kind === 'vertical') {
    const x = pick(positions);
    const y = pick(positions);
    const correct = y < 0.34 ? 0 : y > 0.66 ? 2 : 1;
    return {
      prompt: tl(
        'Listen to the pitch: is this point low, in the middle, or high?',
        '听音高：这个点在低处、中间还是高处？',
      ),
      shape: makePointShape(`q1v-${Date.now()}`, tl('Mystery point', '神秘点'), x, y),
      options: [tl('Low', '低处'), tl('In the middle', '中间'), tl('High', '高处')],
      correctIndex: correct,
      explanation: tl(
        `This point’s y coordinate is ${speakUnits(y)}, so the pitch sounds ${
          correct === 0 ? 'low and deep' : correct === 2 ? 'high and bright' : 'medium'
        }.`,
        `这个点的纵坐标是 ${speakUnits(y)}，所以音高听起来${
          correct === 0 ? '又低又沉' : correct === 2 ? '又高又亮' : '不高不低'
        }。`,
      ),
    };
  }
  const corner = pick([
    { x: 0.15, y: 0.85, label: () => tl('Top left', '左上'), idx: 0 },
    { x: 0.85, y: 0.85, label: () => tl('Top right', '右上'), idx: 1 },
    { x: 0.15, y: 0.15, label: () => tl('Bottom left', '左下'), idx: 2 },
    { x: 0.85, y: 0.15, label: () => tl('Bottom right', '右下'), idx: 3 },
  ]);
  return {
    prompt: tl(
      'Use both clues — left/right and pitch: which corner is this point in?',
      '同时用两个线索——左右和音高：这个点在哪个角落？',
    ),
    shape: makePointShape(`q1q-${Date.now()}`, tl('Mystery point', '神秘点'), corner.x, corner.y),
    options: [tl('Top left', '左上'), tl('Top right', '右上'), tl('Bottom left', '左下'), tl('Bottom right', '右下')],
    correctIndex: corner.idx,
    explanation: tl(
      `The sound was ${corner.x < 0.5 ? 'on the left' : 'on the right'} and the pitch was ${
        corner.y > 0.5 ? 'high' : 'low'
      }, so it’s the ${corner.label().toLowerCase()}.`,
      `声音${corner.x < 0.5 ? '偏左' : '偏右'}，音高${corner.y > 0.5 ? '较高' : '较低'}，所以是${corner.label()}。`,
    ),
  };
}

function genStage2(): Question {
  const kind = pick(['identify', 'steeper'] as const);
  if (kind === 'identify') {
    const candidates = [
      {
        id: 'line-horizontal',
        label: () => tl('Horizontal line', '水平线'),
        why: () =>
          tl(
            'the pitch stays the same while the sound slides left to right',
            '声音从左滑到右，音高保持不变',
          ),
      },
      {
        id: 'line-vertical',
        label: () => tl('Vertical line', '竖直线'),
        why: () => tl('the sound stays centered while the pitch climbs up', '声音保持居中，音高一路爬升'),
      },
      {
        id: 'line-rising',
        label: () => tl('Rising line', '上升斜线'),
        why: () => tl('the pitch climbs while the sound moves right', '声音右移的同时音高升高'),
      },
      {
        id: 'line-falling',
        label: () => tl('Falling line', '下降斜线'),
        why: () => tl('the pitch falls while the sound moves right', '声音右移的同时音高降低'),
      },
    ];
    const answer = pick(candidates);
    return {
      prompt: tl('Listen to the whole line: which kind of line was that?', '听完整条线：刚才是哪种线？'),
      shape: libShape(answer.id),
      options: candidates.map((c) => c.label()),
      correctIndex: candidates.findIndex((c) => c.id === answer.id),
      explanation: tl(
        `That was a ${answer.label().toLowerCase()} — ${answer.why()}.`,
        `刚才是${answer.label()}——${answer.why()}。`,
      ),
    };
  }
  const gentle: [{ x: number; y: number }, { x: number; y: number }] = [
    { x: 0.1, y: 0.4 },
    { x: 0.9, y: 0.6 },
  ];
  const steep: [{ x: number; y: number }, { x: number; y: number }] = [
    { x: 0.35, y: 0.1 },
    { x: 0.65, y: 0.9 },
  ];
  const steepFirst = Math.random() < 0.5;
  const first = steepFirst ? steep : gentle;
  const second = steepFirst ? gentle : steep;
  return {
    prompt: tl(
      'Two slanted lines will play, one after another. Which one is steeper?',
      '将依次播放两条斜线：哪一条更陡？',
    ),
    shape: makeTwoLineShape(`q2s-${Date.now()}`, tl('Two slanted lines', '两条斜线'), first, second),
    options: [tl('The first line', '第一条'), tl('The second line', '第二条')],
    correctIndex: steepFirst ? 0 : 1,
    explanation: tl(
      'The steeper line changes pitch quickly while barely moving left or right. The gentler line slides a long way sideways with only a small pitch change.',
      '更陡的线音高变化快、左右移动少；更缓的线左右滑得远、音高只变一点点。',
    ),
  };
}

function genStage3(): Question {
  const kind = pick(['identify', 'edges', 'closed'] as const);
  if (kind === 'identify') {
    const candidates = [
      { id: 'poly-triangle', label: () => tl('Triangle', '三角形') },
      { id: 'poly-square', label: () => tl('Square', '正方形') },
      { id: 'poly-rectangle', label: () => tl('Rectangle', '长方形') },
      { id: 'poly-trapezoid', label: () => tl('Trapezoid', '梯形') },
      { id: 'poly-rhombus', label: () => tl('Rhombus', '菱形') },
      { id: 'curve-circle', label: () => tl('Circle', '圆形') },
    ];
    const answer = pick(candidates);
    const others = candidates.filter((c) => c.id !== answer.id);
    const options = [answer, ...others.slice(0, 3)].map((c) => c.label());
    const shuffled = [...options].sort(() => Math.random() - 0.5);
    return {
      prompt: tl('Listen to the whole shape: what shape is it?', '听完整个图形：这是什么图形？'),
      shape: libShape(answer.id),
      options: shuffled,
      correctIndex: shuffled.indexOf(answer.label()),
      explanation:
        answer.id === 'curve-circle'
          ? tl(
              'A circle sounds perfectly smooth — no corner clicks anywhere!',
              '圆形的声音完全平滑——从头到尾没有一声顶点咔哒！',
            )
          : tl(
              `Count the corner clicks: a ${answer.label().toLowerCase()} clicks once at every corner.`,
              `数一数顶点咔哒声：${answer.label()}的每个顶点都会咔哒一声。`,
            ),
    };
  }
  if (kind === 'edges') {
    const candidates = [
      { id: 'poly-triangle', edges: 3 },
      { id: 'poly-square', edges: 4 },
      { id: 'poly-pentagon', edges: 5 },
      { id: 'poly-hexagon', edges: 6 },
    ];
    const answer = pick(candidates);
    return {
      prompt: tl('Count the corner clicks: how many sides does this shape have?', '数一数顶点咔哒声：这个图形有几条边？'),
      shape: libShape(answer.id),
      options: [tl('3 sides', '3 条边'), tl('4 sides', '4 条边'), tl('5 sides', '5 条边'), tl('6 sides', '6 条边')],
      correctIndex: answer.edges - 3,
      explanation: tl(
        `This shape has ${answer.edges} sides and ${answer.edges} corners — in a closed shape they always match!`,
        `这个图形有 ${answer.edges} 条边和 ${answer.edges} 个顶点——闭合图形的边数和顶点数总是一样多！`,
      ),
    };
  }
  const closedQ = Math.random() < 0.5;
  return {
    prompt: tl('Listen to the very end: is this shape closed or open?', '注意听结尾：这个图形是闭合的还是开放的？'),
    shape: libShape(closedQ ? 'poly-square' : 'line-polyline'),
    options: [tl('Closed shape', '闭合图形'), tl('Open shape', '开放图形')],
    correctIndex: closedQ ? 0 : 1,
    explanation: closedQ
      ? tl(
          'You heard the special closing chime (three rising notes) — the sound came all the way back to its start!',
          '你听到了专属的闭合提示音（三个上行音）——声音一路回到了起点！',
        )
      : tl(
          'There was only a plain finish sound, no closing chime — the shape never came back to its start.',
          '结尾只有普通结束音，没有闭合提示音——图形没有回到起点。',
        ),
  };
}

function genStage4(): Question {
  const kind = pick(['relation', 'slopeSign', 'openClosed'] as const);
  if (kind === 'relation') {
    const candidates = [
      {
        shape: () => libShape('line-parallel'),
        correct: 0,
        why: () =>
          tl(
            'The two lines moved exactly the same way, and there was no crossing pulse — parallel friends walking side by side!',
            '两条线走得一模一样，也没有交点脉冲音——是并肩散步的平行好朋友！',
          ),
      },
      {
        shape: () =>
          makeTwoLineShape(
            `q4r-${Date.now()}`,
            tl('Crossing lines', '相交线'),
            [
              { x: 0.1, y: 0.2 },
              { x: 0.9, y: 0.8 },
            ],
            [
              { x: 0.1, y: 0.6 },
              { x: 0.9, y: 0.6 },
            ],
          ),
        correct: 1,
        why: () =>
          tl(
            'You heard the crossing pulse, so they meet — but one was slanted and one was flat, so they are not perpendicular.',
            '你听到了交点脉冲音，说明它们相交——但一条是斜线一条是水平线，所以不垂直。',
          ),
      },
      {
        shape: () => libShape('line-perpendicular'),
        correct: 2,
        why: () =>
          tl(
            'A flat line and a straight-up line meeting make a perfect square corner — perpendicular!',
            '一条水平线和一条竖直线相遇，组成一个方方正正的直角——互相垂直！',
          ),
      },
    ];
    const answer = pick(candidates);
    return {
      prompt: tl('Two lines will play one after another: how do they relate?', '两条线会依次播放：它们是什么关系？'),
      shape: answer.shape(),
      options: [
        tl('Parallel', '互相平行'),
        tl('Crossing, but not perpendicular', '相交但不垂直'),
        tl('Perpendicular', '互相垂直'),
      ],
      correctIndex: answer.correct,
      explanation: answer.why(),
    };
  }
  if (kind === 'slopeSign') {
    const rising = Math.random() < 0.5;
    return {
      prompt: tl(
        'Listen to which way the pitch goes: is this a positive or negative slope?',
        '听音高往哪边走：这是正斜率还是负斜率？',
      ),
      shape: libShape(rising ? 'line-rising' : 'line-falling'),
      options: [tl('Positive slope (rising)', '正斜率（上升）'), tl('Negative slope (falling)', '负斜率（下降）')],
      correctIndex: rising ? 0 : 1,
      explanation: rising
        ? tl(
            'The pitch climbed while the sound moved right — the line goes up, so the slope is positive.',
            '声音右移时音高在爬升——线往上走，所以斜率为正。',
          )
        : tl(
            'The pitch dropped while the sound moved right — the line goes down, so the slope is negative.',
            '声音右移时音高在下降——线往下走，所以斜率为负。',
          ),
    };
  }
  const vertexQ = pick([
    { id: 'poly-triangle', count: 3 },
    { id: 'poly-square', count: 4 },
    { id: 'poly-pentagon', count: 5 },
  ]);
  return {
    prompt: tl(
      'Count the corner clicks: how many corners does this closed shape have?',
      '数一数顶点咔哒声：这个闭合图形有几个顶点？',
    ),
    shape: libShape(vertexQ.id),
    options: [tl('3 corners', '3 个顶点'), tl('4 corners', '4 个顶点'), tl('5 corners', '5 个顶点')],
    correctIndex: vertexQ.count - 3,
    explanation: tl(
      `Every little click is one corner — this shape has ${vertexQ.count} of them.`,
      `每一声小小的咔哒就是一个顶点——这个图形一共有 ${vertexQ.count} 个。`,
    ),
  };
}

const GENERATORS: Record<string, () => Question> = {
  stage1: genStage1,
  stage2: genStage2,
  stage3: genStage3,
  stage4: genStage4,
};

interface SessionStats {
  answered: number;
  correct: number;
  replays: number;
  totalMs: number;
}

export default function LessonPanel() {
  const actions = useActions();
  const { state } = useStore();
  const [stage, setStage] = useState('stage1');
  const [question, setQuestion] = useState<Question | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [feedback, setFeedback] = useState('');
  const [showExplain, setShowExplain] = useState(false);
  const [stats, setStats] = useState<SessionStats>({ answered: 0, correct: 0, replays: 0, totalMs: 0 });
  const [progress, setProgress] = useState<LessonProgress>(() => loadProgress());
  const questionStartRef = useRef(0);
  const playedOnceRef = useRef(false);

  /** 把题干、全部选项和按键说明组成一段完整语音（盲人用户的全流程指引） */
  const questionSpeech = useCallback((q: Question, isNew: boolean) => {
    const opts = q.options
      .map((o, i) => tl(`Choice ${i + 1}: ${o}`, `选项 ${i + 1}：${o}`))
      .join(tl('; ', '；'));
    const head = isNew ? tl('New question: ', '新题目：') : '';
    return (
      head +
      tl(
        `${q.prompt} ${opts}. Press Space to hear the sound, answer with the number keys, press P to hear the question again.`,
        `${q.prompt} ${opts}。按空格听声音，按数字键作答，按 P 重听题目。`,
      )
    );
  }, []);

  const newQuestion = useCallback(() => {
    const gen = GENERATORS[stage];
    const q = gen();
    setQuestion(q);
    setPicked(null);
    setFeedback('');
    setShowExplain(false);
    questionStartRef.current = performance.now();
    playedOnceRef.current = false;
    actions.announce(questionSpeech(q, true));
  }, [stage, actions, questionSpeech]);

  useEffect(() => {
    newQuestion();
  }, [stage, newQuestion]);

  const playQuestion = useCallback(
    (speedFactor?: number, segmented?: boolean) => {
      if (!question) return;
      if (playedOnceRef.current) {
        setStats((s) => ({ ...s, replays: s.replays + 1 }));
      }
      playedOnceRef.current = true;
      actions.playAdhocShape(question.shape, { speedFactor, segmented });
    },
    [question, actions],
  );

  const answer = useCallback(
    (index: number) => {
      if (!question || picked !== null) return;
      const correct = index === question.correctIndex;
      setPicked(index);
      const elapsed = performance.now() - questionStartRef.current;
      setStats((s) => ({
        answered: s.answered + 1,
        correct: s.correct + (correct ? 1 : 0),
        replays: s.replays,
        totalMs: s.totalMs + elapsed,
      }));
      setProgress((prev) => {
        const cur = prev[stage] ?? { attempts: 0, correct: 0 };
        const next = {
          ...prev,
          [stage]: { attempts: cur.attempts + 1, correct: cur.correct + (correct ? 1 : 0) },
        };
        saveProgress(next);
        return next;
      });
      actions.previewCue(correct ? 'correct' : 'wrong');
      const message = correct
        ? pick(praiseList())
        : tl(
            `${pick(encourageList())} The answer is: ${question.options[question.correctIndex]}.`,
            `${pick(encourageList())}正确答案是：${question.options[question.correctIndex]}。`,
          );
      setFeedback(message);
      actions.announce(
        message +
          tl(
            ' Press H to hear why, or Enter for the next question.',
            '按 H 听讲解，按 Enter 进入下一题。',
          ),
      );
    },
    [question, picked, stage, actions],
  );

  // 练习页全键盘操作：空格/R 听声音，数字作答，P 重听题目，H 听讲解，Enter 下一题
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (state.helpOpen || state.tutorialActive || state.welcomeOpen) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      // 焦点在按钮上时，空格/回车交给按钮本身
      const onButton = !!target && target.closest('button, a') !== null;
      if (!question) return;

      if ((e.key === ' ' || e.key === 'r' || e.key === 'R') && !(onButton && e.key === ' ')) {
        e.preventDefault();
        playQuestion();
      } else if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        actions.announce(questionSpeech(question, false));
      } else if ((e.key === 'h' || e.key === 'H') && picked !== null) {
        e.preventDefault();
        setShowExplain(true);
        actions.announce(question.explanation);
      } else if (e.key === 'Enter' && !onButton) {
        e.preventDefault();
        if (picked !== null) newQuestion();
        else playQuestion();
      } else if (/^[1-9]$/.test(e.key)) {
        const idx = Number(e.key) - 1;
        if (idx < question.options.length && picked === null) {
          e.preventDefault();
          answer(idx);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    question,
    picked,
    playQuestion,
    questionSpeech,
    newQuestion,
    answer,
    actions,
    state.helpOpen,
    state.tutorialActive,
    state.welcomeOpen,
  ]);

  const accuracy = stats.answered > 0 ? Math.round((stats.correct / stats.answered) * 100) : 0;
  const avgSec = stats.answered > 0 ? (stats.totalMs / stats.answered / 1000).toFixed(1) : '0';
  const stageProgress = progress[stage];

  return (
    <div>
      <h2>
        <span aria-hidden="true">🎓 </span>
        {t('Practice')}
      </h2>
      <div role="group" aria-label={t('Practice stages')} className="view-tabs" style={{ marginBottom: '0.8rem' }}>
        {STAGES.map((s) => (
          <button key={s.id} aria-pressed={stage === s.id} onClick={() => setStage(s.id)}>
            <span aria-hidden="true">{s.emoji} </span>
            {t(s.name)}
          </button>
        ))}
      </div>

      {question && (
        <section aria-label={t('Current question')}>
          <p style={{ fontSize: '1.08rem', fontWeight: 700 }}>{question.prompt}</p>
          <div className="control-bar">
            <button className="primary" onClick={() => playQuestion()}>
              <span aria-hidden="true">🔊 </span>
              {t('Play Question')}
            </button>
            <button onClick={() => playQuestion(0.5)}>
              <span aria-hidden="true">🐢 </span>
              {t('Play Slowly')}
            </button>
            <button onClick={() => playQuestion(undefined, true)}>{t('Edge by Edge')}</button>
          </div>
          <p className="settings-note">
            {t('Keys: Space = hear the sound · 1-4 = answer · P = repeat question · H = why · Enter = next')}
          </p>

          <div className="lesson-options" role="group" aria-label={t('Answer choices')}>
            {question.options.map((opt, i) => {
              const answered = picked !== null;
              const cls =
                answered && i === question.correctIndex
                  ? 'lesson-option-correct'
                  : answered && i === picked
                    ? 'lesson-option-wrong-picked'
                    : '';
              return (
                <button key={i} className={cls} onClick={() => answer(i)} disabled={answered}>
                  {opt}
                </button>
              );
            })}
          </div>

          {picked !== null && (
            <div>
              <p role="status" className="lesson-feedback">
                {feedback}
              </p>
              <button onClick={() => setShowExplain((v) => !v)}>
                {showExplain ? t('Hide explanation') : t('Tell me why')}
              </button>
              {showExplain && <p>{question.explanation}</p>}
              <p>
                <button className="primary" onClick={newQuestion}>
                  <span aria-hidden="true">✨ </span>
                  {t('Next Question')}
                </button>
              </p>
            </div>
          )}
        </section>
      )}

      <div className="lesson-stats" aria-label={t("This session's progress")}>
        <span>
          {t('Answered')}: {stats.answered}
        </span>
        <span>
          {t('Correct')}: {stats.correct}
        </span>
        <span>
          {t('Accuracy')}: {accuracy}%
        </span>
        <span>
          {t('Replays')}: {stats.replays}
        </span>
        <span>
          {t('Avg time')}: {avgSec}s
        </span>
        {stageProgress && (
          <span>
            {t('All-time on this step')}: {stageProgress.correct} / {stageProgress.attempts}
          </span>
        )}
      </div>
    </div>
  );
}
