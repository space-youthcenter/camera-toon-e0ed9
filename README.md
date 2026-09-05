# Camera Toon

스마트폰 카메라 위에 종이 장난감 카메라를 띄우고, 촬영한 결과의 프레임 안쪽만 펜선과 색연필로 그린 듯 바꾸는 모바일 웹앱입니다.

**웹앱 실행:** https://space-youthcenter.github.io/camera-toon/

**Netlify 실행:** https://glittery-caramel-9ffb9a.netlify.app/

## 특징

- 앱을 열면 카메라 권한을 요청하고 실시간 미리보기를 시작합니다.
- 촬영 전에는 필터 없는 일반 카메라 미리보기를 표시합니다.
- 촬영한 결과에서만 종이 카메라 안쪽에 펜선·색연필 스케치 효과가 적용됩니다.
- 촬영한 전체 장면을 하나의 PNG 이미지로 저장할 수 있습니다.
- 기본 무료 모드에서는 사진을 전송하지 않고 브라우저 canvas에서 모든 처리를 완료합니다.
- OpenAI API 변환은 선택 기능이며, 서버에 API 키가 설정된 경우에만 촬영한 내부 화면 crop을 전송합니다.
- 별도의 빌드 과정이 필요 없습니다.
- iPhone Safari를 포함한 모바일 화면에 맞춰져 있습니다.
- 세로·가로 전환 시 프레임, 내부 화면창, 촬영 crop 및 저장 이미지 좌표를 다시 계산합니다.
- 가능한 경우 광각 후면 카메라를 우선 선택하며, 전면·후면 전환 버튼과 줌 슬라이더를 제공합니다.
- `assets/frame-camera.png`가 없으면 임시 종이 카메라 프레임을 자동으로 그립니다.
- 하단 촬영 버튼 왼쪽의 작은 모드 버튼에서 `AI 손그림`과 `기본 모드`를 확인하고 전환할 수 있습니다. 연결 상태는 작은 색 점으로 표시합니다.

## 기본 무료 모드와 선택형 AI 변환

Camera Toon의 기본 모드는 무료입니다. 촬영 후 종이 카메라 안쪽 영역에 검은 펜선, 거친 색연필 해칭, 종이결과 불균일한 채색을 브라우저 canvas로 적용합니다. 사진은 기기 밖으로 전송되지 않습니다. 사용자 화면에는 별도의 필터 이름을 상시 표시하지 않으며 앱 이름은 `Camera Toon`으로 통일합니다.

OpenAI AI 변환은 선택 기능입니다. Netlify 서버에 `OPENAI_API_KEY`가 설정된 경우에만 촬영된 전체 사진이 아닌 종이 카메라 내부 화면 crop을 함수로 전송합니다. AI 설정이 없거나 호출이 실패하면 오류 메시지를 반복해서 띄우지 않고 무료 Paper Toon 필터를 사용합니다.

촬영 전 미리보기에는 보정을 적용하지 않습니다. 셔터를 누르는 순간 현재 프레임 한 장을 확정하고 미리보기를 즉시 정지 화면으로 바꾼 뒤, 내부 화면 영역만 변환합니다. 프레임 바깥은 촬영 당시의 원본을 그대로 유지합니다. 변환 중에는 셔터, 렌즈 전환, 줌 조절을 잠그고 `사진 촬영은 완료됐어요.` 안내를 표시합니다.

AI 처리 중에는 정지 사진 위의 작은 종이 카드에서 연필, 윤곽선, 색연필 결, 별이 움직이며 `사진 촬영 완료!` → `검은 펜으로 윤곽선을 그리고 있어요...` → `색연필로 슥슥 칠하는 중...` → `조금만 기다리면 완성!` 순서로 안내합니다. 오래 걸리면 마지막 두 마무리 문구를 자연스럽게 반복하고, 응답이 도착하면 즉시 애니메이션을 끝냅니다. 기본 모드는 긴 연출 없이 `손그림 만드는 중...`만 잠깐 표시합니다.

AI에는 종이 카메라 화면 영역만 긴 변 최대 896px로 축소하고 JPEG로 한 번 인코딩해 전송합니다. 촬영 한 번당 브라우저 캡처와 API 요청은 각각 한 번이며 자동 재시도는 하지 않습니다. 함수는 기본적으로 `quality=low`, JPEG 결과와 화면 비율에 맞춘 출력 크기를 사용해 대기 시간과 전송량을 줄입니다.

하단 모드 버튼을 누르면 카메라를 다시 시작하지 않고 `AI 손그림`과 `기본 모드`를 전환합니다. 기본값은 AI 손그림이지만 Netlify Function 또는 API 설정을 사용할 수 없는 환경에서는 기본 모드로 자동 전환됩니다. 기본 모드를 선택한 촬영에서는 `/api/transform`을 호출하지 않습니다. 촬영 결과 화면에는 실제 처리 결과에 따라 `AI 손그림 변환 완료` 또는 `기본 손그림 효과로 변환했어요`가 표시되며 이 문구는 저장 이미지에 합성되지 않습니다.

처리 시간은 브라우저 콘솔의 `[Camera Toon timing]` 로그에서 촬영→crop, API 요청→응답, 응답→합성, 전체 시간과 실제 crop 해상도로 확인할 수 있습니다. 함수 로그에는 OpenAI 이미지 편집 요청 자체의 시간도 기록됩니다.

API 키는 브라우저 코드나 GitHub 저장소에 넣지 않습니다.

> **배포 환경에 따른 차이**
>
> - **GitHub Pages:** 항상 무료 Paper Toon 모드로 작동합니다.
> - **Netlify, API 키 없음:** 무료 Paper Toon 모드로 정상 작동합니다.
> - **Netlify, API 키 있음:** AI 손그림 변환을 먼저 사용하고 실패 시 무료 모드로 조용히 전환합니다.

## Netlify 배포

1. 이 GitHub 저장소를 Netlify의 **Import an existing project**로 연결합니다.
2. 배포 설정을 아래와 같이 입력합니다.

   | 항목 | 설정값 |
   | --- | --- |
   | Production branch | `main` |
   | Base directory | 비워 둠 |
   | Build command | 비워 둠 |
   | Publish directory | `.` |
   | Functions directory | `netlify/functions` |

   이 앱은 HTML, CSS, JavaScript 정적 파일을 그대로 배포하므로 Build command가 필요하지 않습니다. 저장소의 `netlify.toml`에도 같은 설정이 들어 있습니다.

AI 변환을 사용하지 않는다면 아래 환경 변수 단계는 건너뛰어도 됩니다. 앱은 무료 모드로 정상 작동합니다.

3. 선택형 AI 변환을 사용할 때만 Netlify 사이트 화면에서 **Project configuration → Environment variables**로 이동합니다.
4. **Add a variable**을 눌러 Key에 `OPENAI_API_KEY`, Value에 실제 OpenAI API 키를 입력합니다. 저장소, `script.js`, `netlify.toml`에는 키를 적지 마세요.
5. 범위(scope)를 선택할 수 있는 요금제라면 **Functions**를 포함합니다. 배포 문맥은 최소 **Production**에 값을 설정합니다.
6. 선택적으로 `OPENAI_IMAGE_MODEL`을 추가하고 값으로 `gpt-image-2`를 입력합니다. 생략해도 함수의 기본값은 `gpt-image-2`입니다. `OPENAI_IMAGE_QUALITY`도 선택 사항이며 생략하면 속도 우선의 `low`를 사용합니다. 필요할 때만 `medium` 또는 `high`로 올리세요.
7. 환경 변수를 추가하거나 변경한 뒤에는 **Deploys → Trigger deploy → Deploy site**로 다시 배포해야 새 값이 적용됩니다.

함수 파일은 `netlify/functions/transform-image.mjs`이고, 공통 OpenAI 호출 코드는 `netlify/functions/lib/openai-image.mjs`입니다. `netlify.toml`의 리다이렉트가 `/api/transform`을 `/.netlify/functions/transform-image`로 연결합니다.

배포가 끝나면 Netlify가 제공한 다음 형식의 운영 주소에서 앱을 여세요.

`https://YOUR-NETLIFY-SITE-NAME.netlify.app/`

이 주소에서 Camera Toon 앱을 열고 직접 촬영하여 AI 변환 여부를 확인합니다. API 주소는 `https://YOUR-NETLIFY-SITE-NAME.netlify.app/api/transform`이지만 POST 전용이므로 주소창에서 직접 여는 방식이 아니라 앱에서 촬영하여 테스트해야 합니다.

AI 변환이 실패하면 결과는 자동으로 **브라우저 Paper Toon** fallback으로 생성됩니다. 이때 Netlify의 **Logs → Functions → transform-image** 로그에서 API 키, 결제 한도, 모델 접근 권한 또는 요청 오류를 확인할 수 있습니다.

## 카메라 렌즈와 줌

- 첫 실행 후 `enumerateDevices()`로 사용할 수 있는 비디오 입력을 확인합니다.
- 앱은 `facingMode: environment`로 후면 카메라를 먼저 시작합니다. 우측 상단 전환 버튼은 후면과 전면을 번갈아 선택하며, 각각 `environment`와 `user`를 사용합니다.
- 권한 허용 후 기기 이름을 확인할 수 있으면 `enumerateDevices()` 결과에서 해당 방향의 카메라를 함께 찾아 안정적으로 선택합니다. 후면에서는 초광각·광각 카메라를 우선합니다.
- 전면 카메라는 미리보기와 촬영 canvas를 모두 좌우 반전하므로 저장 결과도 사용자가 화면에서 본 방향과 같습니다. crop과 AI 합성은 이 반전이 완료된 촬영 canvas 좌표를 그대로 사용합니다.
- 브라우저가 카메라 `zoom` constraint를 지원하면 실제 렌즈 줌을 적용하되 UI 최대값은 기기 최대 배율과 4× 중 작은 값으로 제한합니다. 카메라를 전환하면 해당 카메라의 최소값(일반적으로 1×)으로 초기화합니다.
- 지원하지 않거나 track 제약 적용이 실패하면 캔버스 중앙 crop을 이용한 1×~4× 디지털 줌으로 대체합니다.
- 실제 0.5× 화각은 기기가 초광각 렌즈를 웹 브라우저에 별도 카메라로 제공할 때만 선택할 수 있습니다.

## GitHub Pages 배포

이 저장소의 `main` 브랜치에 파일을 올리면 GitHub Actions가 자동으로 배포합니다.

처음 한 번 저장소의 **Settings → Pages → Build and deployment → Source**에서 **GitHub Actions**를 선택해 주세요.

배포 주소 형식은 다음과 같습니다.

`https://GITHUB-USERNAME.github.io/camera-toon/`

현재 주소 `https://space-youthcenter.github.io/camera-toon/`에서는 OpenAI AI 변환이 작동하지 않고 무료 Paper Toon fallback만 작동합니다. 이 주소는 카메라 권한, 렌즈 전환, 줌, 화면 방향 전환, 촬영 및 저장 테스트용으로 사용할 수 있습니다. OpenAI AI 변환은 Netlify의 `https://glittery-caramel-9ffb9a.netlify.app/`에서만 사용할 수 있습니다.

## 실제 카메라 프레임 사용

투명 PNG 프레임을 `assets/frame-camera.png`에 넣으세요. 이미지가 없으면 크림색 종이 질감, 불규칙한 검은 외곽선, 셔터·플래시·하트·MENU·OK 장식이 있는 캔버스 종이공작 프레임이 표시됩니다. 화면 구멍의 위치가 다르면 `script.js`의 `getScreenRect()` 비율을 조정하면 됩니다.
