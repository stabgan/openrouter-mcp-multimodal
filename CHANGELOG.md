# Changelog

All notable changes to `@stabgan/openrouter-mcp-multimodal` are recorded here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [5.1.0](https://github.com/stabgan/openrouter-mcp-multimodal/compare/v5.0.1...v5.1.0) (2026-10-07)


### Features

* add fusion, subagent, response_healing, and web_blocked_domains to chat_completion ([75d0d00](https://github.com/stabgan/openrouter-mcp-multimodal/commit/75d0d006524b6c67542b46d4675567b0700c6598))
* add provider routing support to analyze_image, analyze_audio, analyze_video ([cb68d97](https://github.com/stabgan/openrouter-mcp-multimodal/commit/cb68d970a5d4d787413805a339569f4c58df6e30))
* add reasoning_effort parameter to chat completion tools ([e35387b](https://github.com/stabgan/openrouter-mcp-multimodal/commit/e35387b8768f108d03cea91b9ef4867ec3a3be82))
* add response_format support to chat_completion and start_chat_completion ([e79f38a](https://github.com/stabgan/openrouter-mcp-multimodal/commit/e79f38a31ce99e95403ecc9a13306a92ee681e0e))
* add stop, top_p, frequency_penalty, presence_penalty to chat tools ([92a71b8](https://github.com/stabgan/openrouter-mcp-multimodal/commit/92a71b823d9050228c70c1bf0ba1144ab2343933))
* expand text_to_speech response formats (opus, aac, flac, wav) and add AAC ADTS detection ([1b88d47](https://github.com/stabgan/openrouter-mcp-multimodal/commit/1b88d47dd676753dadbe6a8dba22e112ab29c79f))


### Bug Fixes

* add actionable suggestions to classifyResourceLoadError ([248119d](https://github.com/stabgan/openrouter-mcp-multimodal/commit/248119d450e3a0c2f41be95954e00904a02f89d2))
* add AIFF magic-byte detection and use magic bytes for HTTP audio format detection ([45fdced](https://github.com/stabgan/openrouter-mcp-multimodal/commit/45fdcedd3cc5be63b31ab1808e3e7b0ec58d84c8))
* add Array.isArray guard to validateChatMessages for defensive input validation ([bca87e4](https://github.com/stabgan/openrouter-mcp-multimodal/commit/bca87e4e4901f4af873df674057225f27478815b))
* add Array.isArray guards for array params in image and video handlers ([afa247d](https://github.com/stabgan/openrouter-mcp-multimodal/commit/afa247d8934332f2028a16824a89bcc36d4fe5e7))
* add consecutive poll failure circuit breaker in video generation ([7232003](https://github.com/stabgan/openrouter-mcp-multimodal/commit/7232003c30455eef7a64d85f125c5994ce987c40))
* add content_is_untrusted flag to speech_to_text output ([a436707](https://github.com/stabgan/openrouter-mcp-multimodal/commit/a436707bca7354ca9773c5a23766003cc75cdbfe))
* add defensive optional chaining on completion.choices in generate-image handler ([0a6d08c](https://github.com/stabgan/openrouter-mcp-multimodal/commit/0a6d08cb2922e47923c49e0d0c50555084639a31))
* add details and suggestions to classifyUpstreamError fall-through ([261dfb7](https://github.com/stabgan/openrouter-mcp-multimodal/commit/261dfb702b2ffdb2d1f2788bc496056ba3a9472b))
* add max documents limit (1000) to rerank_documents handler ([2a09669](https://github.com/stabgan/openrouter-mcp-multimodal/commit/2a09669bb240b6c4aeff377066083d8184c64097))
* add missing fusion/subagent/response_healing/web_blocked_domains to start_chat_completion ([47a91a7](https://github.com/stabgan/openrouter-mcp-multimodal/commit/47a91a76b24182c6f46c0aa839f0cae23caf0001))
* add missing HTML error page guards to audio/video URL fetchers ([3f46709](https://github.com/stabgan/openrouter-mcp-multimodal/commit/3f467091c0700b38ffc5cfc436a49597e69d87bb))
* add missing provider param to generate_video_from_image ([f13cf84](https://github.com/stabgan/openrouter-mcp-multimodal/commit/f13cf8418901d24cb8c65bf7c5bbf566027a65bc))
* add missing provider.only property to chat_completion JSON schema ([a028548](https://github.com/stabgan/openrouter-mcp-multimodal/commit/a0285489984df2774fb4547962af3827ea1cf907))
* add missing server-side temperature validation to chat completion handlers ([bb9c5e8](https://github.com/stabgan/openrouter-mcp-multimodal/commit/bb9c5e8175fc2bb2b763e362ab4524ea75263308))
* add missing test for assistant null-content in validateChatMessages ([f5c7582](https://github.com/stabgan/openrouter-mcp-multimodal/commit/f5c75826a47de7f96d99b13fec2f905e3bf30539))
* add missing top-level title to 6 tool definitions for MCP ToolSchema compliance ([f5939a7](https://github.com/stabgan/openrouter-mcp-multimodal/commit/f5939a72e374c60a99ef7f4628a12c68f4ec4df1))
* add MPEG-TS detection to video format detection ([ac430d9](https://github.com/stabgan/openrouter-mcp-multimodal/commit/ac430d9a5ebf035416c6a47a34704aab33ac9ea2))
* add provider routing support to generate_image handler ([8b095bc](https://github.com/stabgan/openrouter-mcp-multimodal/commit/8b095bc788c805ff38419786738e25a22774bebf))
* add provider routing to generate_audio ([3804362](https://github.com/stabgan/openrouter-mcp-multimodal/commit/3804362a54e088e9498c4bfd95a4a93eab846e02))
* add provider routing to text_to_speech and speech_to_text ([cd0be85](https://github.com/stabgan/openrouter-mcp-multimodal/commit/cd0be8559eedbdfd9cd8f5ccd62abebffb2a2f68))
* add random nonce to writeOutputFile temp file name for collision safety ([297400e](https://github.com/stabgan/openrouter-mcp-multimodal/commit/297400eb8f68855a8cd64abdcb5f8783e326c1ea))
* add response size limit to generateSpeech (defense-in-depth) ([ece93ea](https://github.com/stabgan/openrouter-mcp-multimodal/commit/ece93ea9b0970001e0b4026de0d13da57b9eacec))
* add retry suggestions to video download error responses ([db07cb5](https://github.com/stabgan/openrouter-mcp-multimodal/commit/db07cb5dd9fb9a8fd56090ce3b7577f8149996dc))
* add runtime validation for modalities array in generate_image ([772ed37](https://github.com/stabgan/openrouter-mcp-multimodal/commit/772ed3705896d10c8818b1c8de70e436c10defc3))
* add suggestions to MODEL_NOT_FOUND error in get_model_info ([221c9ee](https://github.com/stabgan/openrouter-mcp-multimodal/commit/221c9ee6277db8fe1ae5761b03add024318f40b3))
* add top-level title to all tool definitions for MCP BaseMetadata compliance ([bcfefc6](https://github.com/stabgan/openrouter-mcp-multimodal/commit/bcfefc624ebaaf9b3de395c61ea39e6f5af1d785))
* add video_id input validation to handleGetVideoStatus ([5b290f7](https://github.com/stabgan/openrouter-mcp-multimodal/commit/5b290f7bbc00dfba5d7f5abf504aa575399895a0))
* align idempotentHint with MCP spec for read-only tools ([5f18725](https://github.com/stabgan/openrouter-mcp-multimodal/commit/5f1872569599311d9ad390e6d71dd48cda1659d3))
* apply capResultText to analysis tool responses ([92ecb81](https://github.com/stabgan/openrouter-mcp-multimodal/commit/92ecb8188c538700ce7066b7b4da503911558ec0))
* apply OPENROUTER_PROVIDER_* env defaults to video and image tools ([f97ea13](https://github.com/stabgan/openrouter-mcp-multimodal/commit/f97ea13d0b6b9838acd5bea1a601dff0a3b16c9c))
* auto-enable caching when cache_ttl is provided ([c5e98ee](https://github.com/stabgan/openrouter-mcp-multimodal/commit/c5e98eea49280442a53f7139932a57e8330727ca))
* avoid unnecessary Buffer copy per chunk in readResponseBody ([8767427](https://github.com/stabgan/openrouter-mcp-multimodal/commit/8767427eb2d5a325dce88604d4d56b02dd495183))
* block IPv4-translatable addresses (::ffff:0:) in SSRF guard ([7537044](https://github.com/stabgan/openrouter-mcp-multimodal/commit/7537044a7f8afcdb7f1011ad414f4add6fc18474))
* block NAT64 prefixes (RFC 6052/8215) in SSRF IPv6 blocklist ([9a604ab](https://github.com/stabgan/openrouter-mcp-multimodal/commit/9a604abf1123983e404f1e6d99a86a7b2375fc2d))
* bound safeReadText to prevent memory exhaustion from oversized error responses ([0eaf485](https://github.com/stabgan/openrouter-mcp-multimodal/commit/0eaf485e3a8279936e197f6dc411164d09ab75d7))
* broaden API key redaction and cap error message length ([af97ee2](https://github.com/stabgan/openrouter-mcp-multimodal/commit/af97ee2e95cf5fb9574a95d391da7745d210eb41))
* cache sorted model array to avoid O(n log n) re-sort on every search ([bad2b88](https://github.com/stabgan/openrouter-mcp-multimodal/commit/bad2b88f23da9916d53d311f2f0ec4ee9c24ef96))
* cap image array inputs to prevent unbounded resource consumption ([3b9536a](https://github.com/stabgan/openrouter-mcp-multimodal/commit/3b9536ad28703d598f1a64a0d83ffa42ee0cd22a))
* cap speech_to_text result text to prevent oversized MCP responses ([975cd79](https://github.com/stabgan/openrouter-mcp-multimodal/commit/975cd794d40347f36c151d7603561d695553e87f))
* cap streaming audio accumulation in generate_audio to prevent memory exhaustion ([3910c53](https://github.com/stabgan/openrouter-mcp-multimodal/commit/3910c53648373defc9bde44e404283f4b3ba45cf))
* capture delta.content text in generate_audio streaming for better no-audio diagnostics ([bad44dc](https://github.com/stabgan/openrouter-mcp-multimodal/commit/bad44dc5d2a55b9c9a976978793c3c468ffa7e32))
* classify 'too large' download errors as RESOURCE_TOO_LARGE instead of UPSTREAM_HTTP ([a1314c8](https://github.com/stabgan/openrouter-mcp-multimodal/commit/a1314c85c53605a7eff4df47cacf512b36eff999))
* classify content_filter and length finish reasons correctly in empty-completion errors ([c5004d8](https://github.com/stabgan/openrouter-mcp-multimodal/commit/c5004d812b416aebbf1c629406d94522fb061d0c))
* classify ECONNABORTED, EAI_AGAIN, and EPROTO errors with actionable suggestions ([b1d6dbd](https://github.com/stabgan/openrouter-mcp-multimodal/commit/b1d6dbd5c1f17fbcbe58f7133d06fa418cdd8386))
* classify generate_audio 'no audio' error as UPSTREAM_REFUSED instead of INTERNAL ([43d7a29](https://github.com/stabgan/openrouter-mcp-multimodal/commit/43d7a2913d5563e04daf792c7411c837de0a05a1))
* classify HTTP 408 as UPSTREAM_TIMEOUT and 413 as RESOURCE_TOO_LARGE ([c1f4b17](https://github.com/stabgan/openrouter-mcp-multimodal/commit/c1f4b17130eaf7830cb9b89c385dcf16d991fa4d))
* classify HTTP 504 Gateway Timeout as UPSTREAM_TIMEOUT ([d4d0418](https://github.com/stabgan/openrouter-mcp-multimodal/commit/d4d041813f5b37c01b1de3579e95c2ea0cab19bc))
* classify image fetch errors correctly in video and dedicated-image handlers ([bfc02a5](https://github.com/stabgan/openrouter-mcp-multimodal/commit/bfc02a54b213bf9208e2f819cb6a32808f90e488))
* classify network errors via Node.js error code property, not just message text ([fcea9e5](https://github.com/stabgan/openrouter-mcp-multimodal/commit/fcea9e5f822c29edc46c1b2394ae9ded2f6c03d3))
* classify network-level errors (ECONNREFUSED, ENOTFOUND, etc.) with actionable suggestions ([901188b](https://github.com/stabgan/openrouter-mcp-multimodal/commit/901188b9f3b06f224b1ae5d4f16d19f31f1dc1a0))
* classify SSRF and size-limit errors correctly in generate_video frame/reference image loading ([1bda7b1](https://github.com/stabgan/openrouter-mcp-multimodal/commit/1bda7b135d123b27e6abe78fbf66ee09292b07ed))
* classify timeout errors correctly in analyze/STT resource fetch handlers ([09053e4](https://github.com/stabgan/openrouter-mcp-multimodal/commit/09053e47ccaf61d7fed2a6787f4426ff57050b54))
* classify TLS/certificate errors with actionable suggestions ([1e727c6](https://github.com/stabgan/openrouter-mcp-multimodal/commit/1e727c6eaf2fefeba7827cb298f09a9c830aeff1))
* classify tool_calls and function_call finish reasons correctly in empty-completion errors ([94656d4](https://github.com/stabgan/openrouter-mcp-multimodal/commit/94656d4ee978f52b13cbfd5cf6daa7f2f480bb9c))
* classify undici UND_ERR_HEADERS_TIMEOUT and UND_ERR_BODY_TIMEOUT as UPSTREAM_TIMEOUT ([cf40537](https://github.com/stabgan/openrouter-mcp-multimodal/commit/cf4053719256a921410148bf0e448d28332e270a))
* correct fetchHttpImageValidated return type to string|null matching fetchHttpResource ([3680537](https://github.com/stabgan/openrouter-mcp-multimodal/commit/36805374cecea3b23e8edbd502789b8a6bfd2141))
* correct generate_image bad example — 21:9 is a valid aspect ratio ([8189e09](https://github.com/stabgan/openrouter-mcp-multimodal/commit/8189e0969f6e771ddbfc42f3245de1fb82c164f0))
* correct get_video_status readOnlyHint annotation ([61a0353](https://github.com/stabgan/openrouter-mcp-multimodal/commit/61a0353486b6120e35e05e93539f698f0a454f23))
* correct save_path extension in generate_image_dedicated to match actual image format ([65331ed](https://github.com/stabgan/openrouter-mcp-multimodal/commit/65331edb76538138a5bbe806d9339514fa5c9bf7))
* correct save_path file extension in generate_image to match actual MIME type ([8cbdc22](https://github.com/stabgan/openrouter-mcp-multimodal/commit/8cbdc2201781ff3936ae66b9ee2262980d1d25f2))
* correct text_to_speech description to list all 6 supported formats ([26c48e1](https://github.com/stabgan/openrouter-mcp-multimodal/commit/26c48e11b732443c52116d280254da652bd812f4))
* deduplicate extensionForImageMime, add missing gif/bmp cases in dedicated handler ([3c9711c](https://github.com/stabgan/openrouter-mcp-multimodal/commit/3c9711ce125b6384daa8c6cd6d28c4eb389c2660))
* deduplicate HTTP image fetch logic via shared fetchHttpImageValidated helper ([8a60605](https://github.com/stabgan/openrouter-mcp-multimodal/commit/8a606053d81bfb4d61b5705c1905acd8cb2862a0))
* detect context-length-exceeded errors with actionable suggestions ([b0f61b1](https://github.com/stabgan/openrouter-mcp-multimodal/commit/b0f61b126bdee7dc2eda4e4b021834f4372b2980))
* detect M4A/M4B containers in audio format sniffing ([1e86c51](https://github.com/stabgan/openrouter-mcp-multimodal/commit/1e86c51e66bd148ac00375a889de9715e7cd2152))
* detect plain string error responses in extractEmbeddedError ([f754957](https://github.com/stabgan/openrouter-mcp-multimodal/commit/f754957a74971834ffc26e504974afb8137a38df))
* detect reasoning cutoff in async chat background completions ([1228f43](https://github.com/stabgan/openrouter-mcp-multimodal/commit/1228f43914669bce23ccf9449f865f0cc08a7e02))
* detect SVG in sniffImageMime to prevent wrong MIME/extension ([da66dc5](https://github.com/stabgan/openrouter-mcp-multimodal/commit/da66dc55072ab4ffb716c6ea6f52a32b2e2e3c02))
* enforce data URL size limit in fetchImageWithMime to prevent memory exhaustion ([5191e32](https://github.com/stabgan/openrouter-mcp-multimodal/commit/5191e3229264d4842b01eb3d996a85d35f4ae476))
* enforce file size limit on local video reads in prepareVideoData ([6b1460b](https://github.com/stabgan/openrouter-mcp-multimodal/commit/6b1460bc48cbae0a62d5d109da424a41bd966329))
* enforce integer and minimum validation for poll_interval_ms and max_wait_ms in video generation ([ea5f7de](https://github.com/stabgan/openrouter-mcp-multimodal/commit/ea5f7de6d51dc63d3103e6faecd59f026a040293))
* enforce integer validation for duration in video generation ([63f36cd](https://github.com/stabgan/openrouter-mcp-multimodal/commit/63f36cd26fc702e1e29756bb96ff781e3c1f87fc))
* enforce integer validation for seed and minimum 1 for duration in video generation ([208ed10](https://github.com/stabgan/openrouter-mcp-multimodal/commit/208ed10b4e2fc7afd890631d61212b1128b68108))
* enforce response body size limit on JSON and text API responses ([ef65f09](https://github.com/stabgan/openrouter-mcp-multimodal/commit/ef65f094eece3ab619dec2db1c5a24f499370b04))
* expand incomplete error code taxonomy in README with full 13-code reference table ([f707e08](https://github.com/stabgan/openrouter-mcp-multimodal/commit/f707e0858201570c768b1c98f6d2c67dd2b5c425))
* extract classifyResourceLoadError to unify resource-loading error classification ([1d05206](https://github.com/stabgan/openrouter-mcp-multimodal/commit/1d052067ffb7cd6fa7398b2d21cdd7568de8d526))
* extract finish_reason and usage from generate_audio streaming response ([3d64f7d](https://github.com/stabgan/openrouter-mcp-multimodal/commit/3d64f7dbce54618f44f66ad568baf0266a614cbf))
* extract readResponseBody to eliminate duplicated streaming size-limit code ([2d569bc](https://github.com/stabgan/openrouter-mcp-multimodal/commit/2d569bcd4e25d90d477fc34c9468e60fba7efbb1))
* flag chat completion output as untrusted when web search is enabled ([92b856f](https://github.com/stabgan/openrouter-mcp-multimodal/commit/92b856f4d4f5a7ac72bc4ae1bd1857e18ae56673))
* gracefully skip integration tests when no API key is set ([945fb6b](https://github.com/stabgan/openrouter-mcp-multimodal/commit/945fb6b485120f54af4c748dc377767058cef17f))
* guard against HTML error pages in image URL download ([9a61154](https://github.com/stabgan/openrouter-mcp-multimodal/commit/9a611542cbd624c1e02bd4517a9e28b5f14b7da5))
* guard against HTML error pages in image URL fetch utilities ([c40c747](https://github.com/stabgan/openrouter-mcp-multimodal/commit/c40c747208e106ff1a1f9e5c140a9126d09dde60))
* guard against prototype pollution in dynamic key assignment ([a5b06f5](https://github.com/stabgan/openrouter-mcp-multimodal/commit/a5b06f5a27b5e9a3069e2b91ad45be74a3ce5134))
* guard rerank score extraction against NaN and non-finite values ([5fd0fb2](https://github.com/stabgan/openrouter-mcp-multimodal/commit/5fd0fb281061671f61821d891e88f5424a4bd04b))
* guard resolveJob against TOCTOU race on concurrent disk-load ([eb9baef](https://github.com/stabgan/openrouter-mcp-multimodal/commit/eb9baef301ca0dff2c294efea82446b7af8d54dd))
* guard validateChatMessages against null/undefined/primitive array entries ([895df63](https://github.com/stabgan/openrouter-mcp-multimodal/commit/895df63ac135800985378555233dd7b1128bfcf2))
* handle video/mp2t MIME in generate_video download extension mapping ([9124577](https://github.com/stabgan/openrouter-mcp-multimodal/commit/9124577e47aaf5e666a5ab91f92030d9c62987e8))
* hard-block removed Sora models instead of warn-and-proceed ([dc92b73](https://github.com/stabgan/openrouter-mcp-multimodal/commit/dc92b73d77bba4f6c519478208a40c82e5b4fe09))
* harden async-chat background catch handler with persist+evict cleanup ([3750092](https://github.com/stabgan/openrouter-mcp-multimodal/commit/3750092ced84dd0b925f41abe11c2776ec56040d))
* harden authHeaders against header override via extra spread ([40275a8](https://github.com/stabgan/openrouter-mcp-multimodal/commit/40275a8e003c8e113daeb8d1e5eff1aa316fec01))
* harden cache_ttl validation against non-string inputs ([4bf73e9](https://github.com/stabgan/openrouter-mcp-multimodal/commit/4bf73e95de1c5fa0f4c770461fa0302b8d60c707))
* harden isValidVideoId to reject path traversal, control chars, and path separators ([fb7cb2a](https://github.com/stabgan/openrouter-mcp-multimodal/commit/fb7cb2a80dfa1ef89d184715b1bbe22f1b98a69a))
* harden SSRF blocklist with missing reserved IPv4 ranges ([e9426ea](https://github.com/stabgan/openrouter-mcp-multimodal/commit/e9426ea8efb1e1d52b2a741bd8e4a2606bf58bb6))
* hoist audio lookup maps to module scope and remove unreachable fallback ([25a917b](https://github.com/stabgan/openrouter-mcp-multimodal/commit/25a917b1e9ad71f2924bcc5e46a2131b44b20031))
* include Sora deprecation warning in video job failure responses ([63fbadb](https://github.com/stabgan/openrouter-mcp-multimodal/commit/63fbadbbb9111f9e6d21c03fda5876743bcc5606))
* make Sora deprecation warning date-aware and clean up generate-video ([730aa56](https://github.com/stabgan/openrouter-mcp-multimodal/commit/730aa567074a5a7ac617606feccd26b3adeda931))
* make stripRoutingSuffix case-insensitive for model lookup ([78d631c](https://github.com/stabgan/openrouter-mcp-multimodal/commit/78d631c0344d8ebcac2bc143e20f1fce58ae8ab5))
* normalize provider filter and query in search_models to prevent trailing-slash and whitespace match failures ([88a26c4](https://github.com/stabgan/openrouter-mcp-multimodal/commit/88a26c465282a986ff71efc617d27fefe69a76ed))
* off-by-one in async-chat job eviction + guard completed-without-result ([182916d](https://github.com/stabgan/openrouter-mcp-multimodal/commit/182916dfd48f303ea65770189a9375775f39062e))
* pass response_format through to async chat completion background job ([1019472](https://github.com/stabgan/openrouter-mcp-multimodal/commit/1019472582f601d035d7f7d4684740dd99f947c8))
* pass return_documents through to OpenRouter rerank API ([26c53b4](https://github.com/stabgan/openrouter-mcp-multimodal/commit/26c53b40a76ecfe1232cde92c655c981d206380a))
* pre-truncate sanitizeErrorMessage input to prevent regex DoS on large upstream errors ([1e3d53c](https://github.com/stabgan/openrouter-mcp-multimodal/commit/1e3d53ce66971a9465ce112b71a7be7e1d28e480))
* preserve error suggestions and retry_after through async job lifecycle ([51f1b2f](https://github.com/stabgan/openrouter-mcp-multimodal/commit/51f1b2ff42f19538889d84a594c38c74fbf85cc0))
* preserve stale model cache data when upstream returns empty list ([7297362](https://github.com/stabgan/openrouter-mcp-multimodal/commit/7297362772ddbed58496d78616817337d718efcd))
* prevent response body resource leaks in OpenRouterAPIClient ([eb56515](https://github.com/stabgan/openrouter-mcp-multimodal/commit/eb5651576c011b76487b6472bdf7ac61ff60dd77))
* redact data URLs and base64 blobs in sanitizeErrorMessage ([01cc49f](https://github.com/stabgan/openrouter-mcp-multimodal/commit/01cc49fd683e3dcb2ddd4315bb642479d8a9cdc6))
* redact data URLs with extra MIME parameters in error messages and logs ([245d4d0](https://github.com/stabgan/openrouter-mcp-multimodal/commit/245d4d0ceb5c7d272fea3e05015067c7441dd468))
* reject 0-byte and HTML error responses in text_to_speech handler ([839ddf5](https://github.com/stabgan/openrouter-mcp-multimodal/commit/839ddf5306fd52545df3e53eb7425e08cd8acfff))
* reject 0-byte files and empty HTTP responses in all media input paths ([321d63a](https://github.com/stabgan/openrouter-mcp-multimodal/commit/321d63a04ff1cdd21b4d7e4f5c0892574ee3fd56))
* reject empty string documents in rerank_documents handler ([abf7ef7](https://github.com/stabgan/openrouter-mcp-multimodal/commit/abf7ef753e4c67b83666a5ea4943e7b86e3f3b13))
* reject HTML error pages in video download to prevent corrupt .mp4 files ([845b1d3](https://github.com/stabgan/openrouter-mcp-multimodal/commit/845b1d3274601bcd1a65baf27deb8541badbf26b))
* reject NaN and non-integer values in numeric input validation ([70fd1f0](https://github.com/stabgan/openrouter-mcp-multimodal/commit/70fd1f0594db1cada0bfbe867ebd699b88457476))
* reject non-integer top_n in rerank_documents validation ([822c635](https://github.com/stabgan/openrouter-mcp-multimodal/commit/822c63555ae0185e097b5e83d22229360a74ca90))
* reject non-number types for optional numeric params instead of silently dropping them ([05d3e6d](https://github.com/stabgan/openrouter-mcp-multimodal/commit/05d3e6d0baffc04389d7eabf46c557a7cd26d811))
* reject web_max_results and web_blocked_domains when online is not true ([0dd4fbd](https://github.com/stabgan/openrouter-mcp-multimodal/commit/0dd4fbd41a4bbe4062787f80acf499ff395070cb))
* reject whitespace-only image in generate_video_from_image ([b9089b1](https://github.com/stabgan/openrouter-mcp-multimodal/commit/b9089b1f584a6e6d3e74e28aac3df50437e4a091))
* reject whitespace-only paths in analyze_image, analyze_audio, analyze_video ([28b5e69](https://github.com/stabgan/openrouter-mcp-multimodal/commit/28b5e69d00e6332e67053fda08517bb9666ab3ea))
* remove dead re-exports from generate-audio and video-utils ([b45e37e](https://github.com/stabgan/openrouter-mcp-multimodal/commit/b45e37e7fcd7ef01b61b3689d345687d3b938f3c))
* rename UnsafeOutputPathError to UnsafePathError ([ba4f835](https://github.com/stabgan/openrouter-mcp-multimodal/commit/ba4f835320cd171a4ecf989fa908c8c2bb1f36a7))
* replace stale Sora references with Kling v3.0 in smithery.yaml and build-manifest ([f3f28d7](https://github.com/stabgan/openrouter-mcp-multimodal/commit/f3f28d70247cf7f0a548c44fe04c069c6a9b6b49))
* resolve job status candidate against realpath'd root ([7fe5f90](https://github.com/stabgan/openrouter-mcp-multimodal/commit/7fe5f9072e4f33af62eedcb3fd34fee918859725))
* retry HTTP 408 (Request Timeout) in fetchWithRetry ([ce51fff](https://github.com/stabgan/openrouter-mcp-multimodal/commit/ce51fff46897465c3757decca639e6e52cd1e295))
* sanitize embedded upstream error messages to prevent credential leaks ([49cfdc7](https://github.com/stabgan/openrouter-mcp-multimodal/commit/49cfdc756fa5dee590f4932c6e2cf70ee1b1ec90))
* sanitize error messages in toolErrorFrom to prevent credential leaks ([f6dbfbc](https://github.com/stabgan/openrouter-mcp-multimodal/commit/f6dbfbc24646316eb7e6a44095538764bfb29cf3))
* sanitize upstream error bodies at source to prevent credential leaks ([926ed12](https://github.com/stabgan/openrouter-mcp-multimodal/commit/926ed1216785209a385929a82f4e2979939ec5d2))
* set error_code to INTERNAL when async chat model returns no text ([6333d27](https://github.com/stabgan/openrouter-mcp-multimodal/commit/6333d277b2ec6a869ce1cae0a2621ec97d4c5600))
* skip extractEmbeddedError in pollVideoJob for failed job statuses ([2e5dc5c](https://github.com/stabgan/openrouter-mcp-multimodal/commit/2e5dc5c65e65c014fde3666f3668a676792da7a8))
* skip redundant base64 decode-re-encode round-trip in image generation ([cddcf98](https://github.com/stabgan/openrouter-mcp-multimodal/commit/cddcf9830754fee78a78ed4ccbdac67f275b0617))
* sniff actual MIME type in generate_image_dedicated when output_format is omitted ([73950b7](https://github.com/stabgan/openrouter-mcp-multimodal/commit/73950b71a24c80bc5ce2c7c4dac3154ddd7f166f))
* strip routing suffixes from search_models query for catalog matching ([80bbcd3](https://github.com/stabgan/openrouter-mcp-multimodal/commit/80bbcd3c5c0c4813f2fe94c0bfcfe0a765da2c69))
* surface model refusal reason in generate_image error response ([59d716a](https://github.com/stabgan/openrouter-mcp-multimodal/commit/59d716a8ea980ee60ec9964fb63d609ba0444de2))
* tighten abort string match in classifyUpstreamError to prevent misclassification ([5c89abe](https://github.com/stabgan/openrouter-mcp-multimodal/commit/5c89abe7a6587026be62e0f16a54481ef97075ee))
* trim model param in validate_model and get_model_info for consistency ([90c7572](https://github.com/stabgan/openrouter-mcp-multimodal/commit/90c7572c0396e4d7cca2740b6be37edc72c2388a))
* trim whitespace-only model params to use default instead of sending blank to API ([03032be](https://github.com/stabgan/openrouter-mcp-multimodal/commit/03032be4c29babba432bfe06c93dc2244c9d82ad))
* use canonical IMAGE_SIZES constant instead of duplicated inline array in generate-image handler ([29fe63d](https://github.com/stabgan/openrouter-mcp-multimodal/commit/29fe63d42f1c60860b16e40d462f9f9b89053c55))
* use case-insensitive error classification in analyze_video handler ([7dd79bf](https://github.com/stabgan/openrouter-mcp-multimodal/commit/7dd79bfc5bd033f0ce0557e2093596e0961b5cdf))
* use classifyResourceLoadError for generate_image input_images errors ([4599fe9](https://github.com/stabgan/openrouter-mcp-multimodal/commit/4599fe977faf4a9916b57cf61bfb8ca4d927042a))
* use explicit typeof string checks in required-field validation across all handlers ([e85edc7](https://github.com/stabgan/openrouter-mcp-multimodal/commit/e85edc7c653b5d58209e945acc12948c862fd906))
* use IANA-registered video/quicktime MIME type for MOV files ([68753dd](https://github.com/stabgan/openrouter-mcp-multimodal/commit/68753dd0943401718212c7918b11c9620e2cfc66))
* use JSON Schema type 'integer' for integer-only tool parameters ([d456ffb](https://github.com/stabgan/openrouter-mcp-multimodal/commit/d456ffbe544438ebcc39ed842e346a1df30ee503))
* use magic-byte detection for STT HTTP audio format resolution ([58ea6d8](https://github.com/stabgan/openrouter-mcp-multimodal/commit/58ea6d8312a99b389d469eae258a289bc54b9d70))
* use O_EXCL for temp files in writeOutputFile to prevent symlink attacks ([dcf0944](https://github.com/stabgan/openrouter-mcp-multimodal/commit/dcf0944d8acebf23e70a952c6d9307a4ce00c599))
* use shared image fetch limits in generate_image_dedicated URL download ([ba9ce49](https://github.com/stabgan/openrouter-mcp-multimodal/commit/ba9ce49cb549c3f4b1b0cd417826e3aa5f19b1bf))
* use UNSUPPORTED_FORMAT for non-content-filter no-audio errors in generate_audio ([ba8654e](https://github.com/stabgan/openrouter-mcp-multimodal/commit/ba8654e8893383c11c6da1fef877644961a3a305))
* validate array items are non-empty strings in image/video handlers ([47fb309](https://github.com/stabgan/openrouter-mcp-multimodal/commit/47fb309389a3178d3b275d8d6c50ca638b3e4cda))
* validate envelope.id after video submission to prevent undefined polling ([b864d6e](https://github.com/stabgan/openrouter-mcp-multimodal/commit/b864d6ed3236330ff93bfbcb458c30476bebf448))
* validate instructions, language, resolution, and aspect_ratio types to reject non-string inputs ([049f2b4](https://github.com/stabgan/openrouter-mcp-multimodal/commit/049f2b455f420139309341e829a28e65e79977f0))
* validate limit and offset types in search_models to reject non-number inputs ([ad48fae](https://github.com/stabgan/openrouter-mcp-multimodal/commit/ad48fae145be4c7ac4aa2e914416fa54bee291b1))
* validate model and return_documents types in rerank_documents to reject non-string/non-boolean inputs ([c899804](https://github.com/stabgan/openrouter-mcp-multimodal/commit/c8998043895d3c3c8e62ab6d38af1afc5b1b631e))
* validate model and voice parameter types across all handlers to reject non-string inputs ([0c71e2e](https://github.com/stabgan/openrouter-mcp-multimodal/commit/0c71e2e7b378777821cdbe47b5a0b044b560f99f))
* validate numeric params in generate-video to prevent NaN busy-loop ([7b13bc2](https://github.com/stabgan/openrouter-mcp-multimodal/commit/7b13bc21baa15714a4452786e9b9367a129ffd42))
* validate query, provider, and capabilities types in search_models to reject non-string/non-object inputs ([a6f4c60](https://github.com/stabgan/openrouter-mcp-multimodal/commit/a6f4c60e64d3837be8c68bbbd2a9b4c35d15a428))
* validate question parameter type in analyze handlers to reject non-string inputs ([b483d97](https://github.com/stabgan/openrouter-mcp-multimodal/commit/b483d97562f95d0d7e9fd0802ce96e3b1d2551eb))
* validate web_max_results and web_blocked_domains in chat handlers ([98f0699](https://github.com/stabgan/openrouter-mcp-multimodal/commit/98f06993686e4ec24cf19a42ae3bbf948ed8bded))
* wrap raw PCM output in WAV header for text_to_speech handler ([f020718](https://github.com/stabgan/openrouter-mcp-multimodal/commit/f02071831e099247e650246757c80eabfeb62cc2))
* wrap writeOutputFile in generate-audio with proper error handling ([eee01a1](https://github.com/stabgan/openrouter-mcp-multimodal/commit/eee01a1f4fd1da63e907de47ee060007ac9fd069))

## [5.0.1] — 2026-09-05

Patch release: dependency security updates and refreshed security policy documentation.

### Security

- **npm transitive dependency updates** — `fast-uri` 3.1.5 → 3.1.7 (high: SSRF/host-confusion in URI parsing, via `@modelcontextprotocol/sdk` → `ajv`), `qs` 6.15.3 → 6.16.0 (moderate: DoS / array-limit bypass, via MCP SDK → `express`), `@humanfs/node` 0.16.7 → 0.16.8 (moderate: dev-only ESLint dependency). Outbound tool HTTP fetches use custom IP-pinned fetch logic, not `fast-uri`; the server uses stdio transport only (Express is not started). Updates reduce supply-chain exposure in published npm/Docker artifacts.
- **`SECURITY.md` refreshed** — Documents 5.0.x support, DNS rebinding mitigation (4.8.0), and credential redaction controls.

## [5.0.0] — 2026-09-02

Major release: retired default models replaced, minimum Node.js raised to 22, OpenAI SDK v7, modernized CI/CD and supply chain, and toolchain updates across Docker, GitHub Actions, and dev dependencies.

### Fixed

- **Default chat and vision model was retired upstream** — `nvidia/nemotron-nano-12b-v2-vl:free` no longer exists on OpenRouter and returned `404 No endpoints found`, so `chat_completion`, `start_chat_completion`, and `analyze_image` failed for anyone who did not set `OPENROUTER_DEFAULT_MODEL`. The default is now **`google/gemma-4-26b-a4b-it:free`**, verified live for both text and image input.
- **Default reranker model was retired upstream** — `cohere/rerank-english-v3.0` returned `400 Model does not exist`, breaking `rerank_documents` by default. Now **`cohere/rerank-v3.5`**.
- **Default dedicated TTS model was retired upstream** — `openai/gpt-4o-mini-tts-2025-12-15` and the documented alternatives were no longer accepted by `POST /audio/speech`. The default is now the live-verified free model **`deepgram/flux-tts:free`** with voice **`flux-alexis-en`**.
- **Dedicated TTS request defaults were inconsistent with the API** — `mp3` is now sent explicitly when omitted, the default voice is only sent with the default model, and `response_format` accepts the endpoint's documented `mp3` and `pcm` values.
- **Retired models in test and e2e fixtures** — the free-model helpers referenced `nvidia/nemotron-nano-12b-v2-vl:free` and `meta-llama/llama-3.2-3b-instruct:free`, both since removed from OpenRouter. Replaced with live-verified free models.
- **`version:check` now covers `python/README.md` and `llms.txt`** — only `README.md` pins were validated before, so `llms.txt` silently kept `4.7.0` install pins through the 4.8.0 release. Docker Hub tags are now checked alongside GHCR tags.
- **`npm run test:smoke:uvx:local` never tested the local build** — the script packed a tarball but did not set `MCP_UVX_LOCAL=1`, so it silently validated the last *published* release instead. It now runs against the local package, and refuses to fall back to a stale tarball.

### BREAKING

- **Minimum Node.js is now 22** — Node 20 reached end of life on 2026-04-30. Install Node 22 LTS or newer before upgrading. On Node 20, `npm install` emits an engine warning and the runtime is unsupported; behavior may break without notice.
- **`openai` SDK upgraded from v4 to v7** — v7 itself requires Node ≥ 22. This is an internal dependency change only; the MCP tool names, JSON schemas, and result shapes are unchanged.

### Changed

- **MCP protocol version in `health_check`** — Now reports **`2025-11-25`**, derived from `@modelcontextprotocol/sdk`'s `LATEST_PROTOCOL_VERSION` instead of a hardcoded string, so it cannot drift from the SDK. The actual handshake was always negotiated by the SDK; no client behavior changes.
- **`@modelcontextprotocol/sdk` 1.29.0 → 1.30.0.**
- **Docker base image** — Moved from `node:22-alpine` to `node:24-alpine` (Active LTS) and is now **pinned by digest** for reproducible builds.
- **`@types/node` pinned to the 22.x line** — Type-checking matches the supported Node floor and cannot green-light APIs missing on Node 22.
- **Dev toolchain** — ESLint 9 → 10, plus `sharp`, `prettier`, `vitest`, and `typescript-eslint` updates.

### CI/CD and supply chain

- **GitHub Actions bumped to current majors** — Removes the deprecated Node 20 action runtime.
- **PyPI Trusted Publishing (OIDC)** — Replaces a long-lived API token so build attestations are honored.
- **CI test matrix** — Node **22 and 24**.
- **Docker smoke on every pull request** — Image is built and MCP-handshake smoke-tested on PRs, not only on tagged releases.
- **Dependabot** — Enabled for GitHub Actions, npm, and Docker base-image digests.
- **`.dockerignore` tightened** — Local `.env` files and `*.tgz` artifacts cannot enter the build context.

**Upgrade notes:** Upgrade the host to **Node 22+** before installing `@stabgan/openrouter-mcp-multimodal@5.0.0`. No MCP client or tool-call changes are required. If you publish PyPI from CI, register the trusted publisher on PyPI **before** pushing tag `v5.0.0` (see [`docs/RELEASING.md`](docs/RELEASING.md)).

## [4.8.0] — 2026-09-02

Minor release: security hardening across outbound fetches and path sandbox, correctness fixes for audio/STT/caching/model lookup, and expanded validation and observability.

### Security

- **DNS-rebinding SSRF closed** — Outbound media fetches pin the socket to a pre-validated IP via `node:http`/`node:https` with a custom `lookup`, re-validating and re-pinning on every redirect hop; TLS SNI and certificate validation unchanged.
- **Symlinked intermediate directory escape** — `resolveSafeInputPath` now resolves ancestor realpaths so a symlinked parent directory cannot bypass the input sandbox.
- **Obfuscated IPv4 literals blocked** — Octal, decimal, and shorthand forms (e.g. `0177.0.0.1`, `2130706433`, `127.1`) are rejected before fetch.
- **Path hardening** — Null bytes rejected in caller-supplied paths; path prefix comparison is case-insensitive on Windows.
- **Credential redaction** — API keys are redacted from error messages, `health_check` output, and logs; the logger also guards against circular-reference crashes.
- **Response body draining** — Redirect and error paths now drain response bodies, fixing a socket leak under load.
- **Publish workflow hardened** — `publish.yml` jobs run only on version tags, the tag is verified against `package.json`, and an in-flight release can no longer be cancelled.

### Fixed

- **`analyze_audio` local file size limit** — Local sandbox files bypassed `OPENROUTER_AUDIO_MAX_DOWNLOAD_BYTES` while HTTP, data-URL, and `speech_to_text` paths enforced it; local inputs now stat-check before read and reject oversize files with `RESOURCE_TOO_LARGE`.
- **`generate_audio` corrupt multi-chunk output** — Independently padded base64 chunks were concatenated before a single decode; each chunk is now decoded before concatenation (affected most non-trivial audio).
- **`speech_to_text` text/srt/vtt failures** — Responses in `text`, `srt`, or `vtt` format were always parsed as JSON; plain-text formats are now handled correctly.
- **`cache_ttl` duration strings ignored** — Values like `"5m"` and `"1h"` (the examples in the tool schema) were forwarded verbatim and never honored upstream; they are now normalized to integer seconds so response caching works when following the docs.
- **`get_model_info` / `validate_model` routing suffixes** — Valid model ids with `:nitro`, `:floor`, `:free`, `:online`, or `:exacto` suffixes returned `MODEL_NOT_FOUND`; lookup is now suffix-aware and case-insensitive.
- **`search_models` unstable pagination** — Pages could skip or repeat models because pagination used insertion order; results are now stably sorted.
- **Auth and upstream error mapping** — Invalid or missing API keys returned `INVALID_INPUT` instead of `INVALID_CREDENTIALS`; upstream 404s map to `MODEL_NOT_FOUND`, HTTP-date `Retry-After` is honored, and a 200 response carrying an embedded error is no longer treated as success.
- **Cancelled video jobs** — Cancelled jobs polled until timeout and reported as still running; they are now terminal. A throwing progress hook no longer aborts the poll loop.
- **Empty upstream payloads** — Zero-byte and empty upstream payloads were reported as successful saves; file writes are now atomic (temp file plus rename) so a failure cannot leave a truncated file.
- **`text_to_speech` wrong file extension** — The saved extension came from the requested format rather than actual bytes (e.g. `.mp3` containing WAV); the extension now comes from magic-byte detection and `_meta.save_path` reflects the final path.
- **Async chat job ID collisions** — Job IDs used a restart-resettable counter and could overwrite a previous run's persisted job directory; they now include random entropy. Completed jobs are evicted from memory instead of accumulating forever.
- **Unhandled rejections and shutdown** — Background completions and failed progress notifications no longer cause unhandled promise rejections; `SIGTERM` shuts down cleanly (Docker/Kubernetes); a throwing handler returns a tool error instead of a JSON-RPC internal error.
- **`OPENROUTER_INLINE_MAX_BYTES` floor** — Explicit values below 4096 were silently ignored; explicit values are now respected and `0` means never inline.
- **Tool-router type safety** — Removed an unsound cast at the tool-router boundary that masked a real type error; `tsc` now genuinely validates that path.
- **Compressed responses** — `gzip`, `deflate`, and `br` responses are now decompressed; the size cap applies to decompressed bytes.
- **Input validation gaps** — Closed gaps for `rerank_documents` out-of-range indices and non-positive `top_n`, `text_to_speech` `speed` outside 0.25–4.0, `generate_image_dedicated` `n` above 10 and unvalidated `aspect_ratio`, and empty or null chat message content.
- **`analyze_image` / `analyze_video` cache validation order** — Invalid `cache_ttl` was validated after reading and decoding local media; validation now runs before expensive I/O, matching `analyze_audio`.
- **`chat_completion` / `start_chat_completion` invalid `max_tokens`** — Present-but-invalid values (zero, negative, or non-finite) were silently replaced by the `OPENROUTER_MAX_TOKENS` default; they now return `INVALID_INPUT` while omitted `max_tokens` still falls back to the env default.
- **Stale metadata** — `llms.txt` listed only 14 of 19 tools; `smithery.yaml` and the Python `__version__` had been stuck at 4.5.3; `python/README.md` pinned 4.5.3.

### Added

- **`INVALID_CREDENTIALS` error code** — Additive; clients switching on `_meta.code` should handle it alongside existing codes.
- **New env vars** — `OPENROUTER_PROVIDER_ONLY`, `OPENROUTER_MAX_RESULT_TEXT_CHARS` (default 512000, `0` disables), and `OPENROUTER_ASYNC_JOBS_MEMORY_MAX` (default 200, `0` unlimited).
- **Provider routing `only` field** — Restrict requests to an allowlist of provider slugs.
- **`SECURITY.md`** — Security policy plus README troubleshooting, per-client config paths, and documentation of the binary-result policy.
- **CI and version tooling** — CI tests Node 20 and 22; `server.json` declares path-sandbox and inline-byte settings; `version:check` covers the lockfile, release-please manifest, `smithery.yaml`, Python `__version__`, the CHANGELOG heading, and README pins.

### Changed

- **`cache_ttl` accepts duration strings** — `"30s"`, `"5m"`, `"1h"`, or integer seconds, validated to 1–86400.
- **Result text cap** — Completion and rerank result text is capped by default; raise or disable via `OPENROUTER_MAX_RESULT_TEXT_CHARS`.
- **Canonical enums from schemas** — Handlers import enums from `tool-definitions.ts` so advertised schemas and runtime validation cannot drift.

**Upgrade notes:** Invalid or missing API keys now return **`INVALID_CREDENTIALS`** instead of **`INVALID_INPUT`** — update any client logic that keyed off the old code. Chat and rerank result text is **capped at 512000 characters by default**; set `OPENROUTER_MAX_RESULT_TEXT_CHARS=0` to disable or raise the limit. **`cache_ttl`** now rejects genuinely invalid values while **duration strings like `"5m"` and `"1h"` work as documented**.

## [4.7.0] — 2026-09-02

Minor release: canonical MCP binary result policy, security hardening, and contract documentation.

### Added

- **`src/tool-handlers/tool-result-payload.ts`** — Shared `buildBinaryToolResult()` policy for image/audio/video artifacts.
- **`src/tool-handlers/path-utils.ts`** — Shared `replaceExtension()` for output paths.
- **`src/openrouter-openai-client.ts`** — Factory for OpenRouter-attributed OpenAI SDK clients.
- **`resolveSafeJobStatusPath()`** in `path-safety.ts` — realpath guard for async chat job disk reads.
- Tests for save_path text-only results, job_id sandbox, URL+save_path download, TTS extension fix, and MCP video resource blocks.

### Fixed

- **`save_path` duplicate inline media** — When `save_path` is set, tool results are text-only with `_meta.save_path` (no duplicate base64 blocks). Affects `generate_image`, `generate_image_dedicated`, `generate_audio`, `text_to_speech`, and `generate_video`.
- **`async-chat` job_id path traversal** — Reject malicious `job_id` values before disk reads; symlink escape blocked via realpath.
- **`generate_image_dedicated` URL + save_path** — Download provider URL when API returns URL only (or empty `b64_json`) and persist to `save_path`.
- **`text_to_speech` extension mismatch** — `speech.wav` + `response_format: mp3` now writes `speech.mp3`, not `speech.wav.mp3`.
- **OpenRouter attribution headers** on the OpenAI SDK client (`HTTP-Referer`, `X-Title`).

### Changed

- **Inline byte ceilings** — Image/audio default to 1 MiB (`OPENROUTER_INLINE_MAX_BYTES` / per-kind env vars); video remains 10 MiB default. Documented in `.env.example` and tool JSON schemas.
- **Inline video MCP shape** — Video payloads use spec-valid `resource` blocks (blob + mimeType) instead of non-standard `type: video`.
- **Tool schema `save_path` descriptions** — Document text-only result policy and inline size limits.
- **GitHub Releases** — Tag pushes create Release pages with notes extracted from this changelog (`scripts/changelog-section.mjs`).

## [4.6.2] — 2026-08-23

Patch release shipping the v4.6.1 refactor work: shared chat/image/path helpers, extracted tool schemas, expanded test suite, and release automation.

### Changed

- **`src/tool-definitions.ts`** — Tool JSON schemas extracted from the handler router (980 → 246 lines in `tool-handlers.ts`).
- **`src/tool-handlers/chat-request.ts`** — Shared `ChatToolRequest`, `buildChatCompletionBody()`, and OpenAI body mapping for chat tools.
- **`src/tool-handlers/image-source.ts`** — Thin media input layer over `image-utils.fetchImageWithMime()`.
- **`src/tool-handlers/path-safety.ts`** — `resolveOptionalOutputPath()` and `isToolErrorResult()` shared across generate/analyze handlers.
- **`src/tool-handlers/async-chat.ts`** — Disk persistence via `loadJobFromDisk` / `resolveJob`; upstream errors via `classifyUpstreamError`.
- **Deslop pass** — Removed essay/step comments and Unicode dividers across handlers without changing behavior.
- **773 automated tests** (was 682): new coverage for chat-request, async-chat, image-source, chat-completion handler, save-path handlers, and video frame sandbox.
- **Smoke scripts** — Expect 19 tools; npm smoke installs the tarball before spawning the bin.
- **Release CI** — [Release Please](https://github.com/googleapis/release-please) opens version-bump PRs from conventional commits; tag pushes publish npm, PyPI, and Docker together.

## [4.5.3] — 2026-07-02

Distribution release: PyPI `uvx` launcher, full install matrix in README, and CI publish for npm + PyPI + Docker.

### Added

- **PyPI package** `mcp-server-openrouter-multimodal` — `uvx` / `pipx` launcher that execs the npm server (Node 20+ still required).
- **CI `publish-pypi` job** — builds `python/` and publishes to PyPI on version tags (trusted publisher or `PYPI_API_TOKEN` secret).
- **`scripts/smoke-uvx-mcp.mjs`** — stdio smoke for the Python launcher (`npm run test:smoke:uvx` / `test:smoke:uvx:git`).
- **MCP Registry PyPI entry** in `server.json` with `mcp-name` ownership marker in `python/README.md`.
- README install table covering npx, uvx, npm global, Docker, GHCR, Smithery, MCP Registry, Claude Code CLI, Inspector, and Windows `cmd /c npx`.

### Changed

- Dedicated **`ci.yml`** workflow for test badge (separate from release publish failures).
- Release workflow npm publish falls back without provenance when Sigstore is unavailable.
- **uvx launcher** runs `npx` with `cwd=/tmp` and supports `OPENROUTER_MCP_NPM_SPEC` for local `npm pack` tarballs.

## [4.5.2] — 2026-07-02

Security patch closing GHSA-3q7p-736f-x44v (path traversal on analyze\_\* local file inputs), plus tool-description overhaul, performance optimizations, and a major test-suite expansion. Fully backwards compatible with v4.5.1.

### Fixed

- **HIGH — `analyze_image`, `analyze_audio`, `analyze_video` read local paths without sandbox.** Unlike `generate_video` (fixed in v4.0.1), the analyze tools used raw `fs.readFile` / `readFileSync` on caller-supplied paths, allowing exfiltration of arbitrary host files (e.g. `/etc/passwd`, `~/.ssh/id_rsa`) into the OpenRouter request body. All three now route through `resolveSafeInputPath` from `path-safety.ts`; violations return `UNSAFE_PATH`. Regression tests in `src/__tests__/analyze-media-sandbox.test.ts`.

### Added

- **`src/tool-descriptions.ts`** — Structured tool docs with Use when / Do NOT / Good & Bad examples / Fails when / Works with sections, wired into every handler.
- **652 unit + mock tests** (was ~286): strata coverage under `src/__tests__/mock/` for handlers, model cache, security, structured routing, path sandbox.
- **Regression suite** — `vitest.regression.config.ts` + `src/__tests__/regression/regression.test.ts`.
- **Mandatory integration tests** — `src/__tests__/integration.setup.ts` loads `.env`; CI always runs integration with `OPENROUTER_API_KEY`. Default free model: `google/gemma-4-26b-a4b-it:free`.
- **`npm run ci`** — lint + format + build + unit + regression + integration in one command.

### Changed

- **`ModelCache.searchPaginated()`** — Single-pass paginated search; `search_models` uses it.
- **`generate_video`** — Parallel `attachFrameImages` for frame/reference uploads.
- **`image-utils`** — Single sharp pipeline for resize/encode.
- **Docker base image** — `node:22-alpine` (was 20).
- **Dependencies** — `@modelcontextprotocol/sdk` 1.29, `openai` 4.104, `sharp` 0.35, TypeScript 5.9, and other patch/minor bumps.
- **README** — SEO-focused rewrite with corrected examples and testing table.
- **Smoke scripts** — `smoke-docker-mcp.mjs` / `smoke-npm-mcp.mjs` read version + tool count from `package.json` (14 tools).

### Security advisory

- [GHSA-3q7p-736f-x44v](https://github.com/stabgan/openrouter-mcp-multimodal/security/advisories) — patched in **4.5.2**.

## [4.5.1] — 2026-05-04

Patch release fixing two HIGH-severity issues caught by a post-release bug-hunter audit, plus four MEDIUM documentation / correctness fixes. Fully backwards compatible with v4.5.0.

### Fixed

- **HIGH — MCP `initialize` handshake advertised stale version.** `src/index.ts` hardcoded `"4.0.1"` in the `Server` constructor, so every MCP client saw that string on connect regardless of our real version. Now imports `SERVER_VERSION` from `src/version.ts` (single source of truth).
- **HIGH — `notifications/progress` could violate the monotonic-increase requirement.** When OpenRouter alternated numeric `progress: 75` with ticks that omitted the field, our fallback to `attempt` produced small integers (2, 3, …), so clients saw `75 → 2 → 3` — a decrease. MCP 2025-06-18 utilities/progress forbids this. Fix: closure-local `lastSent` counter, always emit `max(lastSent + 1, candidate)`. Regression test in `src/__tests__/progress-monotonic.test.ts`.
- **MEDIUM — `classifyUpstreamError` silently dropped its `contextMessage` parameter.** The argument was prefixed with `_` but 12 call sites relied on it for triage. Now prefixed into the returned message. Covered by `src/__tests__/error-classification.test.ts`.
- **MEDIUM — `suggestions` and `retry_after_seconds` were declared but never populated.** The v4.5.0 CHANGELOG advertised structured error metadata, but no handler wired it up. `classifyUpstreamError` now reads `Retry-After` headers on 429/5xx and attaches canonical suggestions for credits / rate-limit / content-policy / model-not-found / timeouts / 5xx.
- **MEDIUM — `health_check` returned `ok: false` on a successful-but-empty catalog and caused a hot-loop.** `ModelCache.isValid()` tested `Object.keys(models).length > 0`, so a successful `/models` → `[]` response was treated as "not populated", re-fetching on every request. Split the timestamp into `fetchedAt` (legacy) + `populatedAt` (new) and use the latter for freshness. `health_check.ok` now tracks API reachability, not catalog size. Regression tests for both behaviors.
- **MEDIUM — `generate_video` / `get_video_status` timeout contract mismatch.** Tool descriptions said "Fails when: JOB_STILL_RUNNING" but the implementation returns `isError: false` with a resume hint. Descriptions corrected to say "Returns successfully with `_meta.code: JOB_STILL_RUNNING` (NOT an error)".
- **INFO — Fatal-error logging now whitelists fields.** Top-level `uncaughtException` / `unhandledRejection` / `server.onerror` handlers previously `console.error`'d the raw error object. If a future openai-node release changes `APIError.toString()` to include `Authorization`, we'd silently log Bearer tokens to stderr. Defense-in-depth: extract `name` / `message` / trimmed `stack` explicitly via `logger.error('fatal', …)`.

### Added

- `ModelCache.reset()` — test-friendly full invalidation (clears models + timestamps + inflight slot).
- 2 new regression test files: `progress-monotonic.test.ts`, `error-classification.test.ts`. Test count 276 → 286.

### Audit artifact

Full report: 12 findings (0 CRITICAL, 2 HIGH, 4 MEDIUM, 4 LOW, 2 INFO). No credential leaks in source, history, or runtime paths. `.env` gitignored since v2; never committed. Dockerfile runs as unprivileged `app` user with `--chown` on COPYs. SSRF blocklist intact. Path sandbox intact.

## [4.5.0] — 2026-05-04

Major feature release adding 18 enhancements across OpenRouter platform parity, MCP 2025-06-18 spec compliance, and research-driven improvements. Fully backwards compatible.

### Added — OpenRouter platform parity

- **Response caching via `X-OpenRouter-Cache`.** New `cache`, `cache_ttl`, `cache_clear` params on `chat_completion` + analyze\_\* tools. Zero tokens billed on cache hits, 80-300ms latency vs seconds. Server-wide default via `OPENROUTER_CACHE_RESPONSES=1`. `_meta.cache = {status, age, ttl}` surfaced from response headers.
- **Reasoning tokens passthrough.** New `include_reasoning` param on `chat_completion`; when set, upstream reasoning trace surfaces on `_meta.reasoning`. Supports DeepSeek R1, Gemini Thinking, Opus 4.7. Server-wide default via `OPENROUTER_INCLUDE_REASONING=1`.
- **Native finish reason.** `_meta.native_finish_reason` alongside normalized `_meta.finish_reason` on every text-returning tool.
- **`:exacto` suffix documented.** `chat_completion` description + field docstring list `:nitro`, `:floor`, `:exacto` (Auto Exacto reduces tool-call errors ~80% on top tool-calling models).
- **Web search plugin.** New `online: boolean` + `web_max_results: number` on `chat_completion` — injects OpenRouter's Exa-backed plugin (`$4 / 1000 results`).
- **`cache_control` breakpoints on analyze\_\* tools.** New `cache_input: boolean` on `analyze_image`, `analyze_audio`, `analyze_video`. Attaches `cache_control: {type: 'ephemeral'}` to the media block so Anthropic Claude / Gemini 2.5+ prompt-cache it — 10x savings on repeat analysis (Anthropic), 4x (Gemini).
- **`rerank_documents` tool.** New tool backed by OpenRouter's `/rerank` endpoint. Cohere + Fireworks rerankers. Inputs: `query`, `documents[]`, optional `model` (default `cohere/rerank-english-v3.0`), `top_n`, `return_documents`.

### Added — MCP 2025-06-18 spec compliance

- **Structured outputs + `outputSchema`.** `validate_model`, `get_model_info`, `search_models`, `rerank_documents`, `health_check` now emit `structuredContent` with typed JSON + declared `outputSchema`, per MCP §5.2.6-7. Agents can validate responses structurally.
- **Progress notifications.** `generate_video` now emits `notifications/progress` on every poll tick when the client passes a `progressToken` in request `_meta`. Per MCP basic/utilities/progress spec. Agents can show "processing 45%" to users.
- **`title` + `openWorldHint: true` on every tool.** Human-readable display names for clients that surface them; open-world hint reflects that every one of our tools hits external APIs.

### Added — research-driven improvements

- **Failure-mode + inter-tool documentation on every tool.** Per arxiv 2602.18764 (Schema-Guided Dialogue / MCP convergence), every tool description now includes explicit "Fails when:" (ErrorCode triggers) and "Works with:" (related tools in a workflow) sections. Research predicts ~10-15% improvement in tool-selection accuracy.
- **`generate_video_from_image`.** New narrower tool wrapping `generate_video` for image-to-video workflows. Per arxiv 2511.03497: fewer parameters = higher tool-call hit rate.
- **`content_is_untrusted: true` hint on analyze\_\* output.** Inspired by ClawGuard (arxiv 2604.11790) and tool-result-parsing defenses (2601.04795). Flags model output derived from potentially attacker-controlled media so downstream agents can treat it as data, not instructions.
- **Audit logging for paid operations.** New `logger.audit()` method that bypasses the log-level filter. Emitted from `generate_video`, `generate_audio`, `generate_image` with model, 80-char prompt preview (PII boundary), and cost-shape hints. Enables unintended-spend tracing via `docker logs`.
- **Structured error metadata.** `toolError()` accepts optional `suggestions: string[]` and `retry_after_seconds: number`. Agents get concrete next-step options instead of raw strings to interpret. Inspired by Apigene's production MCP best-practice guide.
- **`health_check` tool.** Verifies API-key validity, OpenRouter reachability, and returns server + protocol versions. `{ ok, server_version, protocol_version, api_key_valid, models_cached }`.
- **`search_models` pagination.** New `offset` + `next_offset` + `has_more` + `total` fields in the result. Safely walk large result sets.
- **`_meta.server_version` stamp.** Every successful tool response carries `server_version: "4.5.0"` for debuggability.

### Changed

- Rewrote every tool description (11 existing + 2 new) with explicit "Fails when:" and "Works with:" sections.
- `ModelCache.search()` gains an `all: true` escape hatch for pagination (returns the full filtered set, no limit applied).
- `completion-utils.ts`'s `ExtractedText` interface now carries `nativeFinishReason` + `reasoning` fields, surfaced by the new `buildCompletionMeta()` helper.

### Added — tests

- 11 new test files: `cache`, `structured-output`, `structured-tools`, `rerank`, `health-check`, `generate-video-from-image`, `audit-log`, `progress-notifications`, `pagination`, `content-untrusted`, `error-suggestions`. Test count rises from 205 to 250+.

### Backwards compatibility

All changes are additive. Every new field is optional. No existing caller breaks.

### Citations

- Anthropic announcement: [Response caching](https://openrouter.ai/announcements/response-caching)
- Arxiv [2602.18764](https://arxiv.org/abs/2602.18764) — Schema-Guided Dialogue / MCP convergence principles
- Arxiv [2511.03497](https://arxiv.org/abs/2511.03497) — ROSBag MCP, tool-call accuracy vs parameter count
- Arxiv [2604.11790](https://arxiv.org/abs/2604.11790) — ClawGuard, tool-call boundary enforcement
- Arxiv [2601.04795](https://arxiv.org/abs/2601.04795) — Tool result parsing defense against prompt injection
- Apigene's production MCP best-practice guide (March 2026)
- Phil Schmid, "MCP is Not the Problem, It's your Server" (January 2026)
- MCP spec [2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18/) — structured outputs, progress notifications

## [4.0.1] — 2026-05-04

Security + hygiene patch from an independent audit pass. Two security fixes (one HIGH, one MEDIUM) and the smithery.yaml manifest catching up to v4.

### Fixed

- **HIGH — `generate_video` read arbitrary local files without sandbox.** `first_frame_image`, `last_frame_image`, and `reference_images` did a raw `fs.readFile(source)` with no path check, so an MCP caller could set e.g. `first_frame_image: "/etc/passwd"` or `reference_images: ["/Users/victim/.ssh/id_rsa"]` and exfiltrate arbitrary files to OpenRouter inside the video-job body. `generate_image`'s `input_images` field already had the correct `resolveInputImage` sandbox; this fix extracts that logic into a shared `resolveSafeInputPath` helper in `path-safety.ts` and routes `generate_video`'s image inputs through it. Sandbox violations now return `UNSAFE_PATH` (previously would have silently succeeded). `OPENROUTER_ALLOW_UNSAFE_PATHS=1` legacy bypass still works.
- **MEDIUM — Docker image ran as root.** The final stage had no `USER` directive, so any process-level compromise inside the container ran as uid 0. Added an unprivileged `app` user in the runtime stage and `USER app` before `CMD`. Rebuilt with `--chown=app:app` on the `COPY` lines so file permissions are correct from the start.
- **MEDIUM — `smithery.yaml` stale at v3.0.0.** Bumped to match the package version, added all seven `OPENROUTER_PROVIDER_*` env vars plus `OPENROUTER_MAX_TOKENS` and `OPENROUTER_INPUT_DIR` to both `configSchema.properties` and `config.env`. Smithery UI now shows the full v4 knob set.

### Changed

- **LOW — `OPENROUTER_PROVIDER_ORDER` malformed JSON now logs a warning** instead of silently dropping, so operators get a signal when their env var isn't being honored. Other `OPENROUTER_PROVIDER_*` fields keep the silent-drop policy since their parsers can't usefully distinguish "user intended X" from "user typed garbage."
- **`.gitignore`** now covers `.smithery/` and `.smithery*` patterns alongside the other CLI credential paths (`.mcpregistry_*`).

### Added

- **`src/tool-handlers/path-safety.ts:resolveSafeInputPath`** — new shared helper for input-path sandboxing. Mirrors `resolveSafeOutputPath`'s semantics but for reads only (no mkdir, no directory creation).
- **6 new tests** in `src/__tests__/path-safety-input.test.ts` covering the shared helper (relative accept, absolute inside root, traversal reject, `/etc/passwd` reject, `OPENROUTER_OUTPUT_DIR` fallback, `OPENROUTER_ALLOW_UNSAFE_PATHS=1` bypass). Test count now 205 / 205 green.

## [4.0.0] — 2026-05-04

### License

- **Relicensed from MIT to Apache-2.0.** Apache 2.0 is a permissive superset of MIT's terms with an explicit patent grant and trademark clause. The `LICENSE` file now carries the canonical Apache 2.0 text. The `Apache-2.0` SPDX identifier is set in `package.json`, the `org.opencontainers.image.licenses` Dockerfile label, and the README badge.

### Added — provider routing parity

Brings `chat_completion` up to full parity with [`@mcpservers/openrouterai`](https://www.npmjs.com/package/@mcpservers/openrouterai) on OpenRouter's provider-routing controls. See [https://openrouter.ai/docs/features/provider-routing](https://openrouter.ai/docs/features/provider-routing).

- **`provider` tool-arg on `chat_completion`** accepting the full set of OpenRouter routing options: `quantizations`, `ignore`, `sort` (price / throughput / latency), `order`, `require_parameters`, `data_collection` (allow / deny), `allow_fallbacks`. Merges on top of env-var defaults so callers can override per-request.
- **Model variant suffixes** — `:nitro` (fastest variant) and `:floor` (cheapest variant) pass through natively because OpenRouter parses them server-side. Documented in the README and the `chat_completion` schema.
- **`OPENROUTER_MAX_TOKENS` env var** — default `max_tokens` cap when the tool call doesn't set one. Useful on low-credit and free-tier accounts to avoid the full-context-window reservation that 402s Gemini image models.
- **Seven `OPENROUTER_PROVIDER_*` env vars** — one per provider-routing field. Default values apply to every `chat_completion` call; tool-arg overrides still win.
- **`src/tool-handlers/provider-routing.ts`** — shared helper that parses env defaults (with CSV + JSON-array fallback for `OPENROUTER_PROVIDER_ORDER`), merges overrides, and emits the OpenRouter request body.
- **18 new unit tests** covering env parsing, override merging, body assembly, and `max_tokens` resolution. Total test count 199 / 199 green.

### Changed

- `chat_completion` tool description now advertises the routing and suffix features.
- README: first paragraph, env var table, and Usage Examples updated with provider-routing examples; License section notes the Apache 2.0 transition.
- `.env.example` documents every new env var with inline comments.
- MCP Registry `server.json` lists the eight new env vars so the Smithery / MCP Registry config UI surfaces them automatically.

### Compatibility

- Fully backward-compatible for callers who don't use `provider` or any `OPENROUTER_PROVIDER_*` env var: same request body, same behavior. Only the license file and the chat_completion schema expand.

## [3.2.0] — 2026-05-03

### Added

- **`generate_image` reference images** ([#15](https://github.com/stabgan/openrouter-mcp-multimodal/issues/15), [#16](https://github.com/stabgan/openrouter-mcp-multimodal/pull/16) by [@ahmadsl](https://github.com/ahmadsl)). New optional `input_images: string[]` field on `generate_image`. Each entry is a local file path, an `http(s)://` URL, or a `data:image/...;base64,...` URL. When provided, the user message becomes a multimodal `ChatCompletionContentPart[]`: a text preamble + one `image_url` block per ref, in input order. Enables character/style consistency, image-to-image, and iterative refinement on chat-image models (Gemini Nano Banana, `openai/gpt-5.4-image-2`).
- **`generate_image` modalities override.** New optional `modalities: string[]` field on `generate_image`. Defaults to the `["image","text"]` value v3.1.0 hardcodes; provide e.g. `["text"]` to suppress image output for inspection / captioning.
- **`OPENROUTER_INPUT_DIR` env var.** Sandbox root for `input_images` file paths. Falls back to `OPENROUTER_OUTPUT_DIR`, then `cwd`. Honors `OPENROUTER_ALLOW_UNSAFE_PATHS=1` for the legacy bypass, matching `save_path` semantics.
- **`generate-image.test.ts`.** 18 new unit tests covering `mimeFromExt`, `resolveInputImage` (data/http passthrough, file → base64, traversal rejection, symlink-aware sandbox, env-var fallback), and `buildUserContent` (text vs multimodal branches, preamble, order preservation). Total test count 181.

## [3.1.1] — 2026-05-03

### Added

- **Published to the official [MCP Registry](https://registry.modelcontextprotocol.io)** as `io.github.stabgan/openrouter-multimodal`. The registry replaced the deprecated community list on `modelcontextprotocol/servers` and is now the upstream data source for `wong2/awesome-mcp-servers`, `mcp.so`, and most modern MCP aggregators.
- **`llms.txt`** at the repo root — emerging standard for AI-agent crawlers indexing open-source projects. Condensed summary of install, tools, error taxonomy, and security posture.
- **`server.json`** registry manifest covering the npm package (`@stabgan/openrouter-mcp-multimodal`) and Docker image (`docker.io/stabgan/openrouter-mcp-multimodal`), with environment variable schemas for `OPENROUTER_API_KEY`, `OPENROUTER_DEFAULT_MODEL`, and `OPENROUTER_OUTPUT_DIR`.
- **Dockerfile labels** — `io.modelcontextprotocol.server.name` (required by the MCP Registry to verify OCI-package namespace ownership) plus the standard OCI `org.opencontainers.image.*` annotations so `docker inspect` and Docker Hub's listing surface pick up the metadata.

### Changed

- **README first paragraph** now names the six MCP-compatible clients (Claude Desktop, Cursor, Kiro, VS Code, Windsurf, Cline) and the six LLM families reached through OpenRouter (Claude, Gemini, GPT, Llama, Qwen, Grok) — high-intent search phrases that were previously buried in the doc.
- **Repo topics** rebalanced to 20 high-traffic discovery tags: added `claude-desktop`, `cursor`, `gemini`, `ai-agent`, `tts`, `stt`, `vision`; dropped the low-traffic specific ones (`seedance`, `video-understanding`, `audio-transcription`, `audio-generation`, `nodejs`, `ai`, `image-analysis`). Kept irreplaceable specifics: `veo`, `sora`, `model-context-protocol`, `openrouter`, `multimodal`.
- **GitHub repo description** leads with use case + named clients.
- **Wiki disabled** — was empty and diluted search indexing.

## [3.1.0] — 2026-05-03

### Added

- **`generate_image` now accepts `aspect_ratio` and `image_size`** ([#8](https://github.com/stabgan/openrouter-mcp-multimodal/issues/8)). `aspect_ratio` supports all 14 OpenRouter-documented values (`1:1`, `2:3`, `3:2`, `3:4`, `4:3`, `4:5`, `5:4`, `9:16`, `16:9`, `21:9`, plus the extended `1:4`, `4:1`, `1:8`, `8:1` honored by `google/gemini-3.1-flash-image-preview`). `image_size` supports `0.5K` / `1K` / `2K` / `4K`. Invalid values are rejected client-side with `INVALID_INPUT` before the request is sent — the local enum was verified against OpenRouter's own server-side schema by probing `POST /chat/completions` with an invalid ratio and cross-checking the returned `values` array. End-to-end verified: four images at 16:9, 9:16, 1:1, and 4:3 were generated through the full handler path and the PNG `IHDR` chunks confirmed aspect ratios within ~3% of the request (tiny delta is model-side rounding to OpenRouter's published resolution buckets).
- **`generate_image` now accepts `max_tokens`.** Without this cap OpenRouter reserves the full model context window (~29k tokens for Gemini image models) up front, which 402s free-tier / low-credit accounts even when the actual image completion would cost pennies. `4096` works well in practice.
- **`generate_image` now sends `modalities: ["image", "text"]`** per the current OpenRouter image-generation API. Some multimodal models (including the default `google/gemini-2.5-flash-image`) were already emitting images without this hint, but others reply with text-only refusals unless the modalities are declared explicitly. This removes a latent class of "model returned no image" false negatives.

### Fixed

- **[#13] `fetchHttpResource` now sends a `User-Agent` and `Accept` header.** Node's default `fetch()` ships no UA, and UA-screening CDNs (notably Wikimedia / Varnish) return HTTP 403/400 for such requests. That failure was bubbling to MCP callers through `analyze_image` / `analyze_audio` / `analyze_video` as a bare "HTTP 400" that looked like an OpenRouter / model failure. The UA is now `openrouter-mcp-multimodal/<version> (+<repo-url>)` with the version read from `package.json` at module load so future bumps stay in sync. Originally shipped by [@ZoneoutReal](https://github.com/ZoneoutReal) in [#14](https://github.com/stabgan/openrouter-mcp-multimodal/pull/14); refactored to read the version dynamically in [2843da4](https://github.com/stabgan/openrouter-mcp-multimodal/commit/2843da4).
- **HTTP response body leak in `openrouter-api.ts::fetchWithRetry`.** On 429 / 5xx retries the previous response body was never consumed or cancelled before the backoff sleep, so undici held the pooled connection open until GC reclaimed the `ReadableStream`. Now calls `res.body?.cancel()` before retrying.
- **`generate_image` silently dropped images with MIME parameters in their data URLs.** The old regex `^data:([^;]+);base64,(.+)$` only matched data URLs with zero MIME parameters. Models that emit `data:image/png;charset=binary;base64,...` (some Gemini builds do) were falling through and the tool reported "no image in response" even though the model delivered one. Fixed by delegating to the already-correct `parseBase64DataUrl` from `fetch-utils.ts`.
- **Error shape inconsistency across `search_models` / `get_model_info` / `validate_model`.** These three handlers returned legacy `{ content, isError: true }` without the structured `_meta.code` that every other handler emits. Clients relying on `_meta.code` to branch on error types couldn't tell a `MODEL_NOT_FOUND` from an upstream HTTP failure. Now routed through `toolError` / `classifyUpstreamError`, with missing/invalid `model` input rejected up front.

### Declined

- **[#12]** Encrypted credential storage was declined. MCP servers run locally per-user, so plaintext env var / `.env` is the standard threat model. `.env` is gitignored; OS-level file permissions protect it. An encryption layer would shift complexity onto every user without materially reducing risk for the single-developer local usage that drives this project. Reopen if this ever moves to shared / team environments.

## [3.0.0] — 2026-04-20

### Added

- **`generate_video` tool** — submits a text-to-video job to `POST /api/v1/videos`, polls `GET /api/v1/videos/{id}` until `completed` or `failed`, then downloads the mp4 via `GET /api/v1/videos/{id}/content`. Supports `resolution`, `aspect_ratio`, `duration`, `seed`, `first_frame_image`, `last_frame_image`, `reference_images`, and per-provider `provider` passthrough. Emits MCP `notifications/progress` on every poll. Default model `google/veo-3.1`; override via `OPENROUTER_DEFAULT_VIDEO_GEN_MODEL`.
- **`get_video_status` tool** — resume a previously-submitted video job by id. Handles pending/processing/completed/failed uniformly.
- **`analyze_video` tool** — analyze or transcribe video (mp4, mpeg, mov, webm) from a local file, HTTP(S) URL, or base64 data URL. Uses OpenRouter's `video_url` content type. Default model `google/gemini-2.5-flash`.
- **`video-utils.ts`** — magic-byte detection for mp4/mov (ftyp), webm (EBML), MPEG-PS start codes; SSRF-protected HTTP fetch with 100 MB default cap; data-URL and local-file paths.
- **`openrouter-errors.ts`** — shared classifier that maps OpenAI SDK errors, raw fetch errors, and OpenRouter REST 4xx/5xx responses to the closed `ErrorCode` enum. Extracts HTTP status from `err.status`, `err.code`, or `HTTP NNN` in the message. Distinguishes credits / ZDR / rate limits / model-not-found / content policy.
- **`completion-utils.ts`** — shared helpers that render OpenRouter responses to text. Handles multimodal array content and reasoning-only responses (`content: null` + `reasoning`/`reasoning_details`). Detects `finish_reason === 'length'` on reasoning-only output and returns a structured `INVALID_INPUT` with actionable guidance instead of an empty string. Applied to every tool that calls `chat.completions.create` (chat, analyze_image, analyze_audio, analyze_video).
- **`src/errors.ts`** — closed `ErrorCode` enum (`INVALID_INPUT`, `UNSAFE_PATH`, `UPSTREAM_HTTP`, `UPSTREAM_TIMEOUT`, `UPSTREAM_REFUSED`, `UNSUPPORTED_FORMAT`, `RESOURCE_TOO_LARGE`, `ZDR_INCOMPATIBLE`, `MODEL_NOT_FOUND`, `JOB_FAILED`, `JOB_STILL_RUNNING`, `INTERNAL`). Every handler returns `{ isError: true, _meta: { code, details? } }` so clients can switch on failure modes without regex-parsing free text.
- **`src/logger.ts`** — one JSON line per event on stderr; level filtered by `OPENROUTER_LOG_LEVEL`. Replaces ad-hoc `console.error` output.
- **MCP 2025 tool annotations** — every tool advertises `readOnlyHint`, `destructiveHint`, `idempotentHint`.
- **Fail-fast path sandbox** — `save_path` is validated by `resolveSafeOutputPath` BEFORE spending tokens. Unsafe paths return `UNSAFE_PATH` in milliseconds instead of after the model responds.
- **`search_models` capability filters** — `capabilities.audio` and `capabilities.video` in addition to `vision`.
- **Retry-After-aware video client** — `submitVideoJob`, `pollVideoJob`, `downloadVideoContent` on `OpenRouterAPIClient` all use the jitter/Retry-After-aware `fetchWithRetry` with proper `HTTP-Referer` / `X-Title` attribution headers.
- **Multi-arch Docker image** — CI now builds linux/amd64 + linux/arm64 via buildx + QEMU so Apple Silicon users pull a native image.
- **Live E2E test harness** — `scripts/live-e2e.mjs` drives every tool over stdio against the real OpenRouter API. 16/16 green in the release run. Additional smokes: `scripts/smoke-npm-mcp.mjs` (tarball install + stdio), `scripts/smoke-docker-mcp.mjs` (container + stdio), `scripts/mock-e2e-video.mjs` (full video-gen pipeline with mocked API client).

### Fixed (live-traffic bugs uncovered during E2E smoke)

- **Reasoning-model empty response (P1)** — `chat_completion`, `analyze_image`, `analyze_audio`, `analyze_video` now detect when a model (e.g. NVIDIA Nemotron VL) runs `max_tokens` out during chain-of-thought and emits `content: null`. Instead of returning an empty string, the tools return `INVALID_INPUT` with a reasoning preview and guidance to raise `max_tokens` or pick a non-reasoning model.
- **Image-gen silent text-only fallback (P2)** — `generate_image` now returns `UPSTREAM_REFUSED` (`reason: no_image_in_response`) when the model emits chat text without an image payload, instead of passing the chatter through as "success".
- **Error taxonomy gaps** — `generate_audio`, `generate_image`, `analyze_image`, `analyze_audio`, `chat_completion` were all still using raw string errors without `_meta.code`. All migrated through `toolError` / `classifyUpstreamError`.
- **Generate-video upstream error mapping** — OpenRouter's `POST /videos` responds with `HTTP 400 — Model X does not exist` for unknown models. The classifier now extracts the 400 status from the message and maps "does not exist" to `MODEL_NOT_FOUND` (not the overly-broad `INVALID_INPUT`).
- **Fail-fast save_path** — the path sandbox used to run AFTER the OpenRouter call finished, so a rejected write still burned credits. Now validates before submission (sub-millisecond).

### Fixed (security + correctness)

- **BUG-001 — IPv6 SSRF blocklist bypass (P0).** `isBlockedIPv6` missed IPv4-mapped (`::ffff:127.0.0.1`), IPv4-compatible (`::127.0.0.1`), unspecified (`::`), multicast (`ff00::/8`), 6to4 of private IPv4 (`2002::/16`), documentation (`2001:db8::/32`), Teredo (`2001::/32`), ORCHID, and compressed `::1`. Rewrote with a comprehensive IPv6 expander using `node:net`; 22 new test cases cover every class.
- **BUG-003 — `AbortSignal.timeout` reused across retries (P1).** A shared signal meant retries immediately aborted once the first attempt's deadline elapsed. Each attempt now gets a fresh signal with a full budget.
- **BUG-004 — No `Retry-After` + no jitter (P1).** `fetchWithRetry` now honors `Retry-After` (integer seconds or HTTP-date) and applies a 0.5×–1.5× jitter with a 10-second ceiling to avoid thundering-herd retries.
- **BUG-005 — Hardcoded 24 kHz WAV header (P1).** `createWavHeader` and `wrapPcmInWav` now accept a `sampleRate` argument; default remains 24000 for `openai/gpt-audio` compatibility.
- **BUG-006 — Path traversal on `save_path` (P1).** New `src/tool-handlers/path-safety.ts` sandboxes generate-\* writes against `OPENROUTER_OUTPUT_DIR` (default `process.cwd()`). Absolute paths, `..` escapes, and symlink traversal are rejected.
- **BUG-007 — MP3 magic-byte false positives (P1).** Tightened `detectAudioFormat`'s raw-frame-sync check: version, layer, bitrate index, and sample-rate index must all be non-reserved.
- **BUG-008 — `ModelCache` concurrent populate race (P2).** New `ensureFresh(fetcher)` coalesces concurrent callers onto a single in-flight `/models` request.
- **BUG-009 — Data-URL regex rejected MIME parameters (P2).** New `parseBase64DataUrl` handles `data:audio/wav;charset=binary;base64,...` and similar RFC 2397 variants.
- **BUG-010 — Vitest ran every test twice (P2).** `vitest.config.ts` now includes only `src/__tests__/**/*.test.ts`.
- **BUG-011 — No Content-Length short-circuit (P2).** `readResponseBodyWithLimit` rejects oversize responses before streaming and cancels the body on cap breach.
- **BUG-012 — `prepareImageUrl` mislabeled HTTP images (P2).** `optimizeImage` now returns `{ base64, mime }` with magic-byte MIME sniffing fallback when sharp is unavailable.
- **BUG-015 — Search-models `limit` not clamped (P3).** Now clamped to `[1, 50]` server-side even when callers bypass the JSON schema.
- **BUG-016 — `prepare` script forced rebuild on install (P3).** Renamed to `prepublishOnly`. Dockerfile no longer patches `package.json`.
- **BUG-020 — Tests shipped in `dist/` (P3).** `tsconfig.json` excludes `src/__tests__/**` from emit.

### Changed

- **Install links** — rebuilt all one-click install buttons against the current Kiro / Cursor / VS Code / VS Code Insiders deeplink specs. v2 buttons were broken because they wrapped the server config in `{mcpServers:{...}}` which none of the three IDEs accept. Decoded payloads in an HTML comment for audit.
- **Dev workflow** — `.kiro/` (specs + agents + steering) is now gitignored so workspace artifacts don't leak into the published repo. `.mcp-smoke-output/` is gitignored too.
- **Architecture section** — reflects the new `openrouter-errors.ts`, `completion-utils.ts`, `path-safety.ts`, video client methods on `OpenRouterAPIClient`, tightened IPv6 SSRF coverage, and retry-aware backoff.

### Deferred to a future release

- DNS-rebinding TOCTOU pinning via undici.
- Zod-based runtime arg validation at the dispatch layer.
- Streaming completions for `chat_completion` / `analyze_*`.
- MCP resource attachments for generated media (let LLMs re-fetch outputs as MCP resources).
- Per-model pricing × usage = `_meta.cost_usd` estimation.

## [2.1.0] — Not released

> Internal checkpoint. The fixes listed under Unreleased represent the v2.1 security + correctness audit that lands together with v3 work. If you need a v2.x-only build (without video tools), pin `2.1.0-pre` by building from this commit.

## [2.0.0] — 2026-03

Initial public release with chat, image analysis + generation, audio analysis + generation, model search / info / validate. Native `fetch`, sharp-backed image optimization, streaming audio, SSRF guards for IPv4, Docker + npm + Smithery distribution.
