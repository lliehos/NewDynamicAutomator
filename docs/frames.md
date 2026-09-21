# فریم تو در تو

صفحات هدف چند لایه `iframe`/`frame` دارند. سلکتور عنصر به‌تنهایی کافی نیست.

## مدل

```json
{
  "framePath": [
    { "by": "CssSelector", "value": "iframe#app", "srcHint": "...", "indexInParent": 0 }
  ],
  "elementBy": "CssSelector",
  "elementValue": "#submit"
}
```

در دیتابیس: `Selectors.FramePathJson`.

## رکورد

- content script با `all_frames: true`
- FAB فقط در `window.top`
- رویداد در فریم برگ + `sender.frameId`
- `webNavigation.getAllFrames` زنجیره `parentFrameId`
- در هر والد `executeScript` سلکتور همان iframe را می‌سازد (src + ایندکس)

`frameId` پایدار نیست؛ پخش باید `framePath` را از top resolve کند.

## پخش (فاز ۳ — انجام‌شده)

1. از سند top
2. هر گره `framePath` را پیدا کن
3. هم‌مبدأ: `contentDocument` / پیام به content script
4. کراس‌اوریجین: `executeScript({ frameIds })`
5. سپس عنصر برگ

پیاده‌سازی: `extension/player/engine.js` + `extension/content/player.js`
