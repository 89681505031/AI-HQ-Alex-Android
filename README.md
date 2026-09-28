# AI HQ: Алекс — Android

Android WebView-оболочка для AI HQ V5. Интерфейс и логика V5 находятся в `app/src/main/assets/` и работают локально внутри APK.

## Возможности
- 36 ИИ-сотрудников и отделы
- АРГО и Центр миссий
- 7-этапный многоагентный конвейер
- проекты, совещания и корпоративная память
- ИИ-студия с OpenAI-compatible endpoint / Ollama / LM Studio
- локальное файловое пространство проектов

## Сборка
GitHub Actions автоматически собирает debug APK на каждый push в `main`, либо workflow можно запустить вручную: **Actions → Build APK → Run workflow**.

Локально: `gradle :app:assembleDebug` при установленном Android SDK.

## Предсобранный APK
`release/AI-HQ-Alex-v5.apk` — debug-подписанная автономная сборка, созданная без внешнего Android SDK.
