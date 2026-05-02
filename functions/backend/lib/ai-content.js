const { randomUUID } = require('crypto');
const { ApiError } = require('./http.js');
const { appConfig } = require('./config.js');

const SUPPORTED_PROVIDERS = ['auto', 'gemini', 'openai', 'mock'];
const SUPPORTED_CONTENT_TYPES = ['mock-test', 'daily-quiz'];
const SUPPORTED_DIFFICULTIES = ['easy', 'medium', 'hard'];

const sanitizeProvider = (value) => {
  const provider = String(value || 'auto').trim().toLowerCase();
  return SUPPORTED_PROVIDERS.includes(provider) ? provider : 'auto';
};

const sanitizeContentType = (value) => {
  const contentType = String(value || '').trim().toLowerCase();
  if (!SUPPORTED_CONTENT_TYPES.includes(contentType)) {
    throw new ApiError(400, 'contentType must be mock-test or daily-quiz', { code: 'VALIDATION_ERROR' });
  }
  return contentType;
};

const sanitizeDifficulty = (value) => {
  const difficulty = String(value || 'medium').trim().toLowerCase();
  return SUPPORTED_DIFFICULTIES.includes(difficulty) ? difficulty : 'medium';
};

const sanitizeQuestionCount = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(Math.round(parsed), 3), 100);
};

const normalizeDate = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return new Date().toISOString().slice(0, 10);
  }
  return normalized.slice(0, 10);
};

const extractTextFromOpenAiResponse = (payload) => {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const choice = payload?.choices?.[0]?.message?.content;
  if (typeof choice === 'string' && choice.trim()) {
    return choice.trim();
  }

  if (Array.isArray(choice)) {
    return choice
      .map((entry) => entry?.text || entry?.content || '')
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  return '';
};

const extractJsonString = (value) => {
  const text = String(value || '').trim();
  if (!text) {
    throw new ApiError(502, 'AI provider returned an empty response', { code: 'AI_EMPTY_RESPONSE' });
  }

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] || text;
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return candidate.slice(firstBrace, lastBrace + 1);
  }

  throw new ApiError(502, 'AI provider did not return valid JSON', { code: 'AI_INVALID_JSON' });
};

const ensureQuestionOptions = (options) => {
  if (!Array.isArray(options)) {
    return [];
  }

  return options
    .map((option) => String(option || '').trim())
    .filter(Boolean)
    .slice(0, 6);
};

const buildMockQuestionId = (topic, index) => {
  const safeTopic = String(topic || 'topic')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'topic';
  return `mock_${safeTopic}_${index + 1}`;
};

const buildQuizQuestionId = (topic, index) => {
  const safeTopic = String(topic || 'topic')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'topic';
  return `quiz_${safeTopic}_${index + 1}`;
};

const normalizeGeneratedMockTest = (payload, request) => {
  const rawQuestions = Array.isArray(payload?.questions) ? payload.questions : [];
  if (rawQuestions.length === 0) {
    throw new ApiError(502, 'AI provider returned no mock test questions', { code: 'AI_EMPTY_GENERATION' });
  }

  const questions = rawQuestions.map((question, index) => {
    const options = ensureQuestionOptions(question.options);
    const correctOption = Number(question.correctOption);
    const boundedCorrectOption = Number.isInteger(correctOption) && correctOption >= 0 && correctOption < options.length
      ? correctOption
      : 0;

    return {
      id: String(question.id || buildMockQuestionId(question.topic || request.topic, index)),
      questionText: String(question.questionText || question.prompt || `Practice question ${index + 1}`).trim(),
      options: options.length >= 2 ? options : ['Option A', 'Option B', 'Option C', 'Option D'],
      correctOption: boundedCorrectOption,
      explanation: String(question.explanation || 'Review the underlying concept and retry a similar question.').trim(),
      marks: Math.max(Number(question.marks || 1), 1),
      topic: String(question.topic || request.topic || request.subject || request.exam || 'General Practice').trim(),
    };
  });

  const sectionMap = questions.reduce((accumulator, question) => {
    const key = question.topic || 'General Practice';
    accumulator.set(key, (accumulator.get(key) || 0) + 1);
    return accumulator;
  }, new Map());

  return {
    title: String(
      payload?.title
      || request.title
      || `${request.exam}${request.subject ? ` ${request.subject}` : ''} ${request.topic ? `• ${request.topic} ` : ' '}Mock Test`,
    ).replace(/\s+/g, ' ').trim(),
    description: String(
      payload?.description
      || `AI-generated ${request.type} mock test for ${request.topic || request.subject || request.exam}.`,
    ).trim(),
    category: String(payload?.category || request.exam || 'SSC JE').trim(),
    type: String(payload?.type || request.type || 'sectional').trim(),
    durationMinutes: Math.max(Number(payload?.durationMinutes || request.durationMinutes || 60), 10),
    negativeMarking: Math.max(Number(payload?.negativeMarking ?? request.negativeMarking ?? 0.25), 0),
    totalMarks: questions.reduce((sum, question) => sum + Number(question.marks || 1), 0),
    sectionBreakup: Array.from(sectionMap.entries()).map(([name, count]) => ({ name, questions: count })),
    questions,
  };
};

const normalizeGeneratedDailyQuiz = (payload, request) => {
  const rawQuestions = Array.isArray(payload?.questions) ? payload.questions : [];
  if (rawQuestions.length === 0) {
    throw new ApiError(502, 'AI provider returned no daily quiz questions', { code: 'AI_EMPTY_GENERATION' });
  }

  const questions = rawQuestions.map((question, index) => {
    const options = ensureQuestionOptions(question.options);
    const answer = String(question.answer || options[0] || '').trim();

    return {
      id: String(question.id || buildQuizQuestionId(question.topic || request.topic, index)),
      prompt: String(question.prompt || question.questionText || `Quiz question ${index + 1}`).trim(),
      options: options.length >= 2 ? options : ['Option A', 'Option B', 'Option C', 'Option D'],
      answer: answer || 'Option A',
      explanation: String(question.explanation || 'Review this concept once more to strengthen recall.').trim(),
      topic: String(question.topic || request.topic || request.subject || request.exam || 'General Practice').trim(),
    };
  });

  const sanitizedQuestions = questions.map((question) => {
    const answerExists = question.options.includes(question.answer);
    return {
      ...question,
      answer: answerExists ? question.answer : question.options[0],
    };
  });

  return {
    date: normalizeDate(payload?.date || request.quizDate),
    questions: sanitizedQuestions,
  };
};

const buildSystemPrompt = (request) => [
  'You generate exam-prep assessments for a learning platform.',
  'Return strict JSON only. Do not wrap the response in markdown.',
  'Use clear, realistic, exam-style wording.',
  'Avoid duplicate questions.',
  'Every question must have an explanation.',
  request.contentType === 'mock-test'
    ? 'For mock-test, return: {"title":"","description":"","category":"","type":"","durationMinutes":0,"negativeMarking":0,"questions":[{"id":"","questionText":"","options":["","","",""],"correctOption":0,"explanation":"","marks":1,"topic":""}]}'
    : 'For daily-quiz, return: {"date":"YYYY-MM-DD","questions":[{"id":"","prompt":"","options":["","","",""],"answer":"","explanation":"","topic":""}]}',
].join(' ');

const buildUserPrompt = (request) => {
  const detailLines = [
    `contentType: ${request.contentType}`,
    `exam: ${request.exam}`,
    `subject: ${request.subject || 'General'}`,
    `topic: ${request.topic || 'Mixed topics'}`,
    `difficulty: ${request.difficulty}`,
    `questionCount: ${request.questionCount}`,
    `type: ${request.type || 'sectional'}`,
    `durationMinutes: ${request.durationMinutes || 60}`,
    `negativeMarking: ${request.negativeMarking ?? 0.25}`,
    `quizDate: ${request.quizDate || new Date().toISOString().slice(0, 10)}`,
    `titleHint: ${request.title || ''}`,
    `additionalInstructions: ${request.instructions || ''}`,
  ];

  return [
    'Create production-ready assessment content for an Indian competitive exam app.',
    detailLines.join('\n'),
    request.contentType === 'mock-test'
      ? 'Generate a balanced mock test with varied difficulty, realistic distractors, and exactly the requested number of questions.'
      : 'Generate a concise daily quiz suitable for streak-based engagement and exactly the requested number of questions.',
  ].join('\n\n');
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getErrorMessage = (error) => String(
  error?.message
  || error?.details?.message
  || error?.details?.error?.message
  || '',
).toLowerCase();

const isTransientAiFailure = (error) => {
  const status = Number(error?.status || error?.details?.status || 0);
  const message = getErrorMessage(error);

  if ([408, 409, 425, 429, 500, 502, 503, 504].includes(status)) {
    return true;
  }

  return [
    'high demand',
    'try again later',
    'temporarily unavailable',
    'temporary',
    'rate limit',
    'too many requests',
    'overloaded',
    'timeout',
    'timed out',
    'server error',
    'service unavailable',
  ].some((needle) => message.includes(needle));
};

const callProviderWithRetries = async (provider, operation, options = {}) => {
  const attempts = Math.max(Number(options.attempts || 3), 1);
  const baseDelayMs = Math.max(Number(options.baseDelayMs || 500), 100);
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const canRetry = provider !== 'mock' && attempt < attempts && isTransientAiFailure(error);
      if (!canRetry) {
        throw error;
      }

      await wait(baseDelayMs * attempt);
    }
  }

  throw lastError;
};

const callGemini = async (request) => {
  if (!appConfig.geminiApiKey) {
    throw new ApiError(503, 'Gemini is not configured in this environment', { code: 'AI_PROVIDER_NOT_CONFIGURED' });
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(appConfig.geminiModel)}:generateContent?key=${encodeURIComponent(appConfig.geminiApiKey)}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `${buildSystemPrompt(request)}\n\n${buildUserPrompt(request)}`,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.4,
        responseMimeType: 'application/json',
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(502, payload?.error?.message || 'Gemini generation failed', { code: 'AI_PROVIDER_ERROR' });
  }

  const text = (payload?.candidates || [])
    .flatMap((candidate) => candidate?.content?.parts || [])
    .map((part) => part?.text || '')
    .find(Boolean);

  const parsed = JSON.parse(extractJsonString(text));
  return {
    raw: parsed,
    provider: 'gemini',
    model: appConfig.geminiModel,
    mode: 'live',
  };
};

const callOpenAiCompatible = async (request) => {
  if (!appConfig.aiApiKey) {
    throw new ApiError(503, 'OpenAI-compatible AI provider is not configured in this environment', { code: 'AI_PROVIDER_NOT_CONFIGURED' });
  }

  const baseUrl = String(appConfig.aiBaseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${appConfig.aiApiKey}`,
    },
    body: JSON.stringify({
      model: appConfig.aiModel,
      temperature: 0.4,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: buildSystemPrompt(request) },
        { role: 'user', content: buildUserPrompt(request) },
      ],
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(502, payload?.error?.message || 'OpenAI-compatible generation failed', { code: 'AI_PROVIDER_ERROR' });
  }

  const parsed = JSON.parse(extractJsonString(extractTextFromOpenAiResponse(payload)));
  return {
    raw: parsed,
    provider: 'openai',
    model: appConfig.aiModel,
    mode: 'live',
  };
};

const createLocalQuestionStem = ({ exam, subject, topic, difficulty, index }) => {
  const effectiveTopic = topic || subject || exam || 'General Practice';
  const templates = [
    `Which statement is most accurate about ${effectiveTopic} in a ${difficulty} level ${exam} exam context?`,
    `Choose the best answer related to ${effectiveTopic} for ${exam} preparation.`,
    `Identify the correct concept application in ${effectiveTopic}.`,
    `Which option correctly describes a key idea from ${effectiveTopic}?`,
  ];

  return templates[index % templates.length];
};

const createMockFallback = (request) => {
  const questions = Array.from({ length: request.questionCount }, (_, index) => {
    const topic = request.topic || request.subject || request.exam || 'General Practice';
    const options = [
      `${topic} core principle`,
      `${topic} common misconception`,
      `${topic} unrelated assumption`,
      `${topic} exam trap option`,
    ];

    return {
      id: buildMockQuestionId(topic, index),
      questionText: createLocalQuestionStem({ ...request, index }),
      options,
      correctOption: 0,
      explanation: `The correct answer points to the core ${topic} concept. The other choices represent common distractors used in practice tests.`,
      marks: 1,
      topic,
    };
  });

  return {
    title: request.title || `${request.exam} ${request.topic || request.subject || 'Practice'} Mock Test`,
    description: `Locally generated ${request.type} mock test draft for ${request.topic || request.subject || request.exam}.`,
    category: request.exam,
    type: request.type,
    durationMinutes: request.durationMinutes,
    negativeMarking: request.negativeMarking,
    questions,
  };
};

const createQuizFallback = (request) => {
  const topic = request.topic || request.subject || request.exam || 'General Practice';
  return {
    date: normalizeDate(request.quizDate),
    questions: Array.from({ length: request.questionCount }, (_, index) => ({
      id: buildQuizQuestionId(topic, index),
      prompt: createLocalQuestionStem({ ...request, index }),
      options: [
        `${topic} correct concept`,
        `${topic} partial concept`,
        `${topic} distractor`,
        `${topic} outdated assumption`,
      ],
      answer: `${topic} correct concept`,
      explanation: `This answer reflects the strongest foundational idea in ${topic} for revision-focused daily practice.`,
      topic,
    })),
  };
};

const callMockGenerator = async (request) => ({
  raw: request.contentType === 'mock-test' ? createMockFallback(request) : createQuizFallback(request),
  provider: 'mock',
  model: 'local-rule-engine',
  mode: 'fallback',
});

const resolveProviderOrder = (requestedProvider) => {
  const normalizedProvider = sanitizeProvider(requestedProvider);
  const order = [];

  const addProvider = (provider) => {
    if (!SUPPORTED_PROVIDERS.includes(provider) || order.includes(provider)) {
      return;
    }

    if (provider === 'gemini' && !appConfig.geminiApiKey) {
      return;
    }

    if (provider === 'openai' && !appConfig.aiApiKey) {
      return;
    }

    order.push(provider);
  };

  if (normalizedProvider === 'auto') {
    addProvider('gemini');
    addProvider('openai');
    addProvider('mock');
    return order;
  }

  if (normalizedProvider === 'gemini') {
    addProvider('gemini');
    addProvider('openai');
    addProvider('mock');
    return order;
  }

  if (normalizedProvider === 'openai') {
    addProvider('openai');
    addProvider('gemini');
    addProvider('mock');
    return order;
  }

  addProvider('mock');
  return order;
};

const getAiGenerationProviders = () => {
  const defaultProvider = resolveProviderOrder('auto')[0] || 'mock';
  return {
    defaultProvider,
    providers: [
      {
        id: 'auto',
        label: 'Auto',
        available: true,
        mode: defaultProvider === 'mock' ? 'fallback' : 'live',
        description: 'Pick the best configured provider automatically.',
      },
      {
        id: 'gemini',
        label: 'Gemini',
        available: Boolean(appConfig.geminiApiKey),
        mode: appConfig.geminiApiKey ? 'live' : 'unavailable',
        description: appConfig.geminiApiKey
          ? `Uses ${appConfig.geminiModel}. Good default for low-cost generation.`
          : 'Add GEMINI_API_KEY to enable Gemini generation.',
      },
      {
        id: 'openai',
        label: 'OpenAI-Compatible',
        available: Boolean(appConfig.aiApiKey),
        mode: appConfig.aiApiKey ? 'live' : 'unavailable',
        description: appConfig.aiApiKey
          ? `Uses ${appConfig.aiModel} via ${appConfig.aiBaseUrl}.`
          : 'Add AI_API_KEY or OPENAI_API_KEY to enable an OpenAI-compatible provider.',
      },
      {
        id: 'mock',
        label: 'Local Fallback',
        available: true,
        mode: 'fallback',
        description: 'No external API cost. Generates editable draft content locally.',
      },
    ],
  };
};

const generateAssessmentDraft = async (payload = {}) => {
  const request = {
    provider: sanitizeProvider(payload.provider),
    contentType: sanitizeContentType(payload.contentType),
    exam: String(payload.exam || payload.category || 'SSC JE').trim(),
    subject: String(payload.subject || '').trim(),
    topic: String(payload.topic || '').trim(),
    title: String(payload.title || '').trim(),
    type: String(payload.type || (payload.contentType === 'mock-test' ? 'sectional' : 'daily')).trim(),
    difficulty: sanitizeDifficulty(payload.difficulty),
    questionCount: sanitizeQuestionCount(payload.questionCount, payload.contentType === 'mock-test' ? 20 : 5),
    durationMinutes: Math.max(Number(payload.durationMinutes || 60), 10),
    negativeMarking: Math.max(Number(payload.negativeMarking ?? 0.25), 0),
    quizDate: normalizeDate(payload.quizDate),
    instructions: String(payload.instructions || '').trim(),
  };

  const providerOrder = resolveProviderOrder(request.provider);
  let lastError = null;
  let firstFailure = null;

  for (const provider of providerOrder) {
    try {
      const result = provider === 'gemini'
        ? await callProviderWithRetries('gemini', () => callGemini(request))
        : provider === 'openai'
          ? await callProviderWithRetries('openai', () => callOpenAiCompatible(request))
          : await callMockGenerator(request);

      const normalizedContent = request.contentType === 'mock-test'
        ? { mockTest: normalizeGeneratedMockTest(result.raw, request), dailyQuiz: null }
        : { mockTest: null, dailyQuiz: normalizeGeneratedDailyQuiz(result.raw, request) };

      const usedFallbackFromRequestedProvider = request.provider !== 'auto' && result.provider !== request.provider;
      const autoFallbackMessage = result.mode === 'fallback'
        ? 'Generated using local fallback because live AI providers were unavailable.'
        : `Generated using ${result.provider}. Review before publishing.`;
      const explicitFallbackMessage = result.mode === 'fallback'
        ? `Requested ${request.provider}, but it was temporarily unavailable. Generated using local fallback instead.`
        : `Requested ${request.provider}, but switched to ${result.provider} after a temporary provider failure. Review before publishing.`;

      return {
        provider: result.provider,
        model: result.model,
        mode: result.mode,
        requestedProvider: request.provider,
        contentType: request.contentType,
        fallbackReason: usedFallbackFromRequestedProvider && firstFailure
          ? String(firstFailure.message || 'Primary provider unavailable')
          : null,
        message: usedFallbackFromRequestedProvider
          ? explicitFallbackMessage
          : autoFallbackMessage,
        ...normalizedContent,
      };
    } catch (error) {
      lastError = error;
      if (!firstFailure) {
        firstFailure = error;
      }

      if (provider === 'mock') {
        throw error;
      }
    }
  }

  throw lastError || new ApiError(500, 'Unable to generate assessment draft', { code: 'AI_GENERATION_FAILED' });
};

module.exports = {
  generateAssessmentDraft,
  getAiGenerationProviders,
};
