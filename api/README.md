# DemoAI API (NestJS + Prisma)

Backend для DemoAI. Повторяет пайплайн HorecaGPT минимальным кодом:
**загрузка документа → разбивка на чанки → (эмбеддинги) → сохранение в БД →
ответ чат-ботом по релевантным чанкам (RAG)**.

## Стек

- **NestJS** — API
- **Prisma + PostgreSQL + pgvector** — БД (как в проде HorecaGPT)
- Эмбеддинги: OpenAI `text-embedding-3-small` → колонка `vector(1536)`
- Ответы: Claude (`claude-sonnet-5`)

## Как это повторяет HorecaGPT

| HorecaGPT | DemoAI |
|---|---|
| `document_chunks` (Postgres) | таблица `Chunk` (Prisma) |
| `createOptimalChunks` — абзацы, ~250 слов, 20% overlap | `src/lib/chunking.ts` |
| `text-embedding-3-small` → pgvector `vector` | то же: колонка `Chunk.embedding vector(1536)` |
| retrieval: `embedding_vec <=> query` (cosine) | `ChatService.retrieve` — тот же `<=>` через raw SQL |
| Claude отвечает по контексту | `ChatService.answer` |

`embedding` — это pgvector-колонка (`Unsupported("vector(1536)")` в Prisma),
запись и поиск идут через raw SQL с оператором `<=>`, точно как в HorecaGPT.

Без ключей API работает в демо-режиме: retrieval по совпадению слов + ответ
показывает найденные фрагменты. С ключами — полноценный RAG на pgvector.

## Требования к БД

Нужен PostgreSQL с расширением **pgvector** и отдельная база `demoai`:

```bash
createdb demoai
psql -d demoai -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

Строка подключения — в `.env` (`DATABASE_URL`).

## Запуск

```bash
cd demoai/api
npm install
npx prisma db push      # создаёт таблицы + колонку vector(1536)
npm run build && npm start   # http://localhost:3006
# либо в режиме разработки:
npm run dev
```

Ключи (опционально) — в `.env`:

```
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```

## Эндпоинты

| Метод | Путь | Назначение |
|---|---|---|
| `POST` | `/documents` | Загрузка: multipart `file` **или** JSON `{ name, content }`. Разбивает на чанки и сохраняет. |
| `GET` | `/documents` | Список документов с числом чанков. |
| `DELETE` | `/documents/:id` | Удалить документ (и его чанки). |
| `POST` | `/chat` | `{ message }` → `{ reply, sources }`. Находит релевантные чанки и отвечает. |

## Структура

```
prisma/schema.prisma       Document + Chunk (embedding vector(1536))
src/lib/chunking.ts        разбивка на чанки + ключевые слова
src/lib/embeddings.ts      эмбеддинги + keyword-фоллбэк
src/documents/             upload → chunk → embed → save (raw SQL для vector)
src/chat/                  pgvector-retrieval (<=>) + ответ Claude
```
