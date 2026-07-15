# DemoAI API (NestJS + Prisma)

Backend для DemoAI:
**загрузка документа → разбивка на чанки (LlamaIndex) → эмбеддинги → векторы в Qdrant →
ответ чат-ботом по релевантным чанкам (RAG)**.

## Стек

- **NestJS** — API
- **Prisma + PostgreSQL** — документы, чанки и их метаданные
- **Qdrant** — векторы чанков (cosine, 1536 измерений)
- **LlamaIndex** (`@llamaindex/core`) — чанкинг через `SentenceSplitter`
- Эмбеддинги: OpenAI `text-embedding-3-small`
- Ответы: OpenAI Chat Completions (`gpt-5.4-mini` по умолчанию)

## Как устроено хранение

Данные разделены между двумя базами, связкой служит id чанка:

| Где | Что лежит |
|---|---|
| Postgres, `Document` | имя, полный текст, `chunkerVersion` |
| Postgres, `Chunk` | текст чанка, `index`, `hash`, `startChar`/`endChar`, `tokenCount`, `keywords` |
| Qdrant, коллекция `demoai_chunks` | вектор + payload `{ documentId }` |

`Chunk.id` — это id узла LlamaIndex (UUID), он же id точки в Qdrant. Одна
идентичность на три системы: искать в Qdrant, читать текст из Postgres.
Postgres остаётся источником правды — в Qdrant текст не дублируется.

## Чанкинг

`src/lib/chunking.ts` — `SentenceSplitter` с `chunkSize: 512`, `chunkOverlap: 64`.
Размер считается **в токенах** тем же токенайзером (cl100k_base), которым меряет
`text-embedding-3-small`, поэтому чанки укладываются в лимит точно, а не по оценке
из числа символов.

У каждого узла есть стабильный `hash` от текста: при `POST /documents/:id/reindex`
чанки с неизменившимся текстом сохраняют свою строку и свой вектор, и заново
эмбеддится только реально новый текст.

Без ключей API работает в демо-режиме: retrieval по совпадению слов (по Postgres,
без Qdrant) + ответ показывает найденные фрагменты. С ключами — полноценный RAG.

## Требования

PostgreSQL (расширения не нужны) и Qdrant:

```bash
createdb demoai
docker compose up -d qdrant   # http://localhost:6333/dashboard
```

Настройки — в `.env` (`DATABASE_URL`, `QDRANT_URL`, `QDRANT_COLLECTION`).

## Запуск

```bash
cd demoai/api
npm install
npx prisma db push
npm run build && npm start   # http://localhost:3006
# либо в режиме разработки:
npm run dev
```

Ключ (опционально) — в `.env`. Один и тот же ключ включает и эмбеддинги, и ответы:

```
OPENAI_API_KEY=sk-...
OPENAI_CHAT_MODEL=gpt-5.4-mini   # необязательно; любая модель /v1/chat/completions
```

## Эндпоинты

| Метод | Путь | Назначение |
|---|---|---|
| `POST` | `/documents` | Загрузка: multipart `file` **или** JSON `{ name, content }`. Чанкует, эмбеддит, сохраняет. |
| `GET` | `/documents` | Список документов с числом чанков. |
| `POST` | `/documents/:id/reindex` | Перечанковать документ; заново эмбеддит только изменившийся текст. Ответ: `{ chunks, reused, embedded, deleted }`. |
| `DELETE` | `/documents/:id` | Удалить документ, его чанки и векторы. |
| `POST` | `/chat` | `{ message }` → `{ reply, sources }`. Находит релевантные чанки и отвечает. |

## Структура

```
prisma/schema.prisma       Document + Chunk (текст и метаданные; векторов здесь нет)
src/lib/chunking.ts        LlamaIndex SentenceSplitter (512/64) + ключевые слова
src/lib/embeddings.ts      батч-эмбеддинги OpenAI + keyword-фоллбэк
src/lib/qdrant.service.ts  коллекция, upsert, поиск, удаление векторов
src/documents/             upload → chunk → embed → Postgres + Qdrant, reindex
src/chat/                  поиск в Qdrant → тексты из Postgres → ответ OpenAI
```
