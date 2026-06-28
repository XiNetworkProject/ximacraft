export const cloudVolumeVertexShader = /* glsl */ `
  out vec3 vLocalPosition;

  void main() {
    vLocalPosition = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const cloudVolumeFragmentShader = /* glsl */ `
  precision highp float;
  precision highp sampler3D;

  uniform sampler2D uDensityAtlas;
  uniform sampler3D uBaseNoise3D;
  uniform sampler3D uDetailNoise3D;
  uniform sampler2D uSceneDepth;
  uniform vec3 uCameraLocal;
  uniform vec3 uSunDirection;
  uniform vec2 uAnvilDirection;
  uniform vec2 uLowResolution;
  uniform mat4 uInvProjection;
  uniform mat4 uCameraWorld;
  uniform mat4 uWorldToLocal;
  uniform float uProfile;
  uniform float uOrganization;
  uniform float uDevelopment;
  uniform float uEventIntensity;
  uniform float uOpacity;
  uniform float uPrecipitation;
  uniform float uDayFactor;
  uniform float uStepCount;
  uniform float uJitter;
  uniform float uSeed;
  uniform float uTime;
  uniform vec4 uUpdrafts[5];
  uniform float uAnvilGrowth;
  uniform float uDryAirErosion;
  uniform vec2 uPrecipitationOffset;
  uniform float uDebugDensity;
  uniform vec4 uLightningFlashes[4];
  uniform float uLightningRadii[4];
  uniform vec3 uVolumeHalfSize;

  in vec3 vLocalPosition;
  out vec4 fragColor;

  const float PI = 3.14159265359;

  float saturate(float value) {
    return clamp(value, 0.0, 1.0);
  }

  float remap01(float value, float low, float high) {
    return saturate((value - low) / max(high - low, 0.0001));
  }

  vec2 intersectBox(vec3 rayOrigin, vec3 rayDirection) {
    vec3 safeDirection = sign(rayDirection) * max(abs(rayDirection), vec3(0.00001));
    vec3 invDirection = 1.0 / safeDirection;
    vec3 nearPlane = (-vec3(1.0) - rayOrigin) * invDirection;
    vec3 farPlane = (vec3(1.0) - rayOrigin) * invDirection;
    vec3 nearValue = min(nearPlane, farPlane);
    vec3 farValue = max(nearPlane, farPlane);
    return vec2(
      max(max(nearValue.x, nearValue.y), nearValue.z),
      min(min(farValue.x, farValue.y), farValue.z)
    );
  }

  float sampleDensityAtlas(vec3 uvw) {
    uvw = clamp(uvw, 0.0, 1.0);
    float slice = uvw.z * 47.0;
    float z0 = floor(slice);
    float z1 = min(47.0, z0 + 1.0);
    float blend = fract(slice);
    vec2 localUv = (uvw.xy * 47.0 + 0.5) / 48.0;
    vec2 tile0 = vec2(mod(z0, 7.0), floor(z0 / 7.0));
    vec2 tile1 = vec2(mod(z1, 7.0), floor(z1 / 7.0));
    float a = texture(uDensityAtlas, (tile0 + localUv) / 7.0).r;
    float b = texture(uDensityAtlas, (tile1 + localUv) / 7.0).r;
    return mix(a, b, blend);
  }

  float ellipseMask(vec2 point, vec2 radius, float softness) {
    float distanceFromCenter = length(point / max(radius, vec2(0.001)));
    return 1.0 - smoothstep(1.0 - softness, 1.0, distanceFromCenter);
  }

  vec2 windBasis(vec2 point) {
    vec2 wind = normalize(uAnvilDirection + vec2(0.0001));
    vec2 crossWind = vec2(-wind.y, wind.x);
    return vec2(dot(point, crossWind), dot(point, wind));
  }

  float updraftField(vec3 warped, float height, vec4 updraft, float index) {
    float strength = saturate(updraft.z);
    float verticalGrowth = smoothstep(0.015, 0.12, uDevelopment + 0.08);
    float towerTop = mix(0.3, 0.985, smoothstep(0.05, 0.86, uDevelopment));
    towerTop *= mix(0.72, 1.0, strength);
    float relativeHeight = saturate(height / max(towerTop, 0.08));
    float pulse = sin(relativeHeight * 15.0 + index * 2.3 + uTime * 0.035 + uSeed) * 0.5 + 0.5;
    float bulge = 1.0 + pulse * mix(0.08, 0.28, uDevelopment);
    float taper = mix(1.12, 0.64, pow(relativeHeight, 0.78));
    float radius = updraft.w * taper * bulge;
    vec2 shear = uAnvilDirection * relativeHeight * relativeHeight * uDevelopment * 0.1;
    vec2 wobble = vec2(
      sin(relativeHeight * 8.0 + index * 1.7 + uSeed),
      cos(relativeHeight * 7.0 + index * 2.1 + uSeed * 0.7)
    ) * 0.035 * relativeHeight;
    vec2 center = updraft.xy + shear + wobble;
    float horizontal = ellipseMask(warped.xz - center, vec2(radius * 1.14, radius * 1.08), 0.62);
    float vertical = smoothstep(0.012, 0.075, height)
      * (1.0 - smoothstep(towerTop - 0.1, towerTop, height));
    float crown = exp(-pow((height - towerTop * 0.86) / max(0.08, towerTop * 0.16), 2.0));
    return horizontal * vertical * strength * verticalGrowth * (1.0 + crown * 0.24);
  }

  float cloudEnvelope(vec3 p, float height, vec3 shapeWarp) {
    vec3 warped = p + shapeWarp * vec3(0.1, 0.035, 0.1);
    float towers = 0.0;
    for (int index = 0; index < 5; index += 1) {
      towers = max(towers, updraftField(warped, height, uUpdrafts[index], float(index)));
    }

    float baseGrowth = smoothstep(0.32, 0.82, uDevelopment);
    vec2 baseRadius = mix(vec2(0.4, 0.34), vec2(0.84, 0.7), baseGrowth);
    float baseHorizontal = ellipseMask(warped.xz, baseRadius, 0.48);
    vec2 baseWind = windBasis(warped.xz);
    float leftShelf = ellipseMask(baseWind - vec2(-0.36, 0.04), vec2(0.44, 0.48), 0.6);
    float rightShelf = ellipseMask(baseWind - vec2(0.38, -0.03), vec2(0.4, 0.42), 0.6);
    baseHorizontal = max(baseHorizontal, max(leftShelf, rightShelf) * baseGrowth * 0.84);
    float raggedBase = (shapeWarp.y * 0.016 + shapeWarp.x * 0.008) * baseGrowth;
    float baseVertical = smoothstep(0.008 + raggedBase, 0.05 + raggedBase, height)
      * (1.0 - smoothstep(mix(0.13, 0.2, baseGrowth), mix(0.22, 0.31, baseGrowth), height));
    float flatBase = baseHorizontal * baseVertical * mix(0.28, 0.92, baseGrowth);

    vec2 primary = uUpdrafts[0].xy;
    float calvusGrowth = smoothstep(0.48, 0.74, uDevelopment);
    float capHeight = mix(0.64, 0.9, calvusGrowth);
    float calvusCap = ellipseMask(warped.xz - primary - uAnvilDirection * 0.05, vec2(0.34, 0.31), 0.62);
    calvusCap *= smoothstep(capHeight - 0.17, capHeight - 0.06, height)
      * (1.0 - smoothstep(capHeight + 0.04, capHeight + 0.13, height)) * calvusGrowth;

    vec2 anvilPoint = windBasis(warped.xz - primary);
    float anvilLength = mix(0.54, 1.2, uAnvilGrowth);
    float anvilHorizontal = ellipseMask(anvilPoint - vec2(0.0, anvilLength * 0.22), vec2(0.82, anvilLength), 0.48);
    float anvilCenter = 0.88 + shapeWarp.y * 0.018;
    float anvilVertical = smoothstep(anvilCenter - 0.085, anvilCenter - 0.035, height)
      * (1.0 - smoothstep(anvilCenter + 0.045, anvilCenter + 0.105, height));
    float anvil = anvilHorizontal * anvilVertical * uAnvilGrowth;

    float overshoot = ellipseMask(warped.xz - primary + uAnvilDirection * 0.03, vec2(0.18, 0.16), 0.64);
    overshoot *= smoothstep(0.89, 0.95, height) * (1.0 - smoothstep(0.988, 1.0, height));
    overshoot *= smoothstep(0.74, 0.94, uDevelopment);

    float rainHollow = ellipseMask(warped.xz - uPrecipitationOffset, vec2(0.24, 0.2), 0.66);
    rainHollow *= (1.0 - smoothstep(0.12, 0.42, height)) * uPrecipitation * 0.36;
    float volume = max(flatBase, max(towers, max(calvusCap, max(anvil, overshoot))));
    return saturate(volume - rainHollow);
  }

  vec3 baseNoiseCoordinate(vec3 uvw) {
    vec2 wind = normalize(uAnvilDirection + vec2(0.0001));
    vec3 drift = vec3(wind.x, 0.055, wind.y) * uTime * 0.0012;
    return uvw * vec3(1.35, 1.72, 1.35) + drift + vec3(uSeed * 0.17, uSeed * 0.31, uSeed * 0.11);
  }

  float densityField(vec3 p) {
    vec3 uvw = p * 0.5 + 0.5;
    if (any(lessThan(uvw, vec3(0.0))) || any(greaterThan(uvw, vec3(1.0)))) return 0.0;

    vec3 noiseCoordinate = baseNoiseCoordinate(uvw);
    vec4 low = texture(uBaseNoise3D, noiseCoordinate);
    vec3 shapeWarp = (low.gba * 2.0 - 1.0);
    float envelope = cloudEnvelope(p, uvw.y, shapeWarp);
    float puffDensity = sampleDensityAtlas(uvw);
    float puffEnvelope = smoothstep(0.035, 0.56, puffDensity);
    // Au début, la silhouette suit réellement les puffs simulés. Le profil
    // météorologique ne prend de l'importance qu'avec la maturité : on voit
    // donc les bourgeons naître et se réunir au lieu d'un volume déjà formé.
    float physicalGrowth = smoothstep(0.03, 0.62, uDevelopment);
    float envelopeWeight = mix(0.08, mix(0.72, 1.0, uOrganization), physicalGrowth);
    envelope = saturate(max(puffEnvelope, envelope * envelopeWeight));

    float coverage = saturate(envelope * mix(0.84, 0.98, uOrganization) + puffEnvelope * 0.22);
    float lowWorley = dot(low.gba, vec3(0.58, 0.29, 0.13));
    float baseShape = saturate(low.r * 0.82 + lowWorley * 0.30 - 0.06);
    float density = remap01(baseShape, 1.0 - coverage * 0.82, 1.0);

    float lowErosion = 1.0 - lowWorley;
    density = saturate(density - lowErosion * mix(0.25, 0.055, density) * (0.45 + 0.55 * (1.0 - envelope)));

    vec3 detailCoordinate = noiseCoordinate * vec3(4.25, 3.65, 4.25) + shapeWarp * 0.12;
    vec3 detail = texture(uDetailNoise3D, detailCoordinate).rgb;
    float detailWorley = dot(detail, vec3(0.58, 0.29, 0.13));
    float edge = 1.0 - smoothstep(0.18, 0.72, density);
    float verticalErosion = mix(0.78, 1.18, smoothstep(0.56, 0.97, uvw.y));
    if (uProfile > 2.5 && uvw.y > 0.68) verticalErosion *= mix(0.62, 0.48, uOrganization);
    density = saturate(density - (1.0 - detailWorley) * edge * (0.31 + uDryAirErosion * 0.24) * verticalErosion);

    float verticalBounds = smoothstep(0.004, 0.035, uvw.y)
      * (1.0 - smoothstep(0.975, 0.998, uvw.y));
    vec2 boundaryPoint = uvw.xz * 2.0 - 1.0;
    vec2 boundaryWind = windBasis(boundaryPoint);
    float boundaryRadius = length(boundaryWind / vec2(mix(0.86, 1.08, uAnvilGrowth), 0.94));
    float boundaryBreakup = (low.g - 0.5) * 0.13 + (low.b - 0.5) * 0.07;
    float horizontalBounds = 1.0 - smoothstep(0.72 + boundaryBreakup, 1.0 + boundaryBreakup, boundaryRadius);
    return density * verticalBounds * horizontalBounds;
  }

  float coarseDensity(vec3 p) {
    vec3 uvw = p * 0.5 + 0.5;
    if (any(lessThan(uvw, vec3(0.0))) || any(greaterThan(uvw, vec3(1.0)))) return 0.0;
    vec4 low = texture(uBaseNoise3D, baseNoiseCoordinate(uvw));
    vec3 warp = low.gba * 2.0 - 1.0;
    float envelope = cloudEnvelope(p, uvw.y, warp);
    float puffEnvelope = smoothstep(0.035, 0.56, sampleDensityAtlas(uvw));
    float coverage = saturate(max(envelope, puffEnvelope * 0.64));
    float shape = saturate(low.r * 0.82 + dot(low.gba, vec3(0.17, 0.08, 0.04)));
    return remap01(shape, 1.0 - coverage * 0.78, 1.0);
  }

  float henyeyGreenstein(float anisotropy, float cosTheta) {
    float g2 = anisotropy * anisotropy;
    return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * anisotropy * cosTheta, 0.001), 1.5));
  }

  float dualLobePhase(float cosTheta, float anisotropyScale) {
    float forward = henyeyGreenstein(0.62 * anisotropyScale, cosTheta);
    float backward = henyeyGreenstein(-0.24 * anisotropyScale, cosTheta);
    return mix(forward, backward, 0.16) * 4.0 * PI;
  }

  float lightEnergy(vec3 samplePosition, vec3 lightDirection, float cosTheta) {
    float opticalDepth = 0.0;
    for (int lightStep = 0; lightStep < 4; lightStep += 1) {
      float distanceToLightSample = 0.055 + float(lightStep) * 0.085;
      opticalDepth += coarseDensity(samplePosition + lightDirection * distanceToLightSample)
        * mix(0.92, 0.55, float(lightStep) / 3.0);
    }

    float energy = 0.0;
    float extinctionScale = 1.0;
    float contribution = 1.0;
    float anisotropyScale = 1.0;
    for (int octave = 0; octave < 3; octave += 1) {
      energy += exp(-opticalDepth * 1.65 * extinctionScale)
        * dualLobePhase(cosTheta, anisotropyScale)
        * contribution;
      extinctionScale *= 0.52;
      contribution *= 0.43;
      anisotropyScale *= 0.72;
    }
    return energy;
  }

  void main() {
    vec3 rayDirection = normalize(vLocalPosition - uCameraLocal);
    vec2 intersection = intersectBox(uCameraLocal, rayDirection);
    float startDistance = max(intersection.x, 0.0);
    float endDistance = intersection.y;
    if (endDistance <= startDistance) discard;

    vec2 screenUv = gl_FragCoord.xy / uLowResolution;
    float sceneDepth = texture(uSceneDepth, screenUv).r;
    if (sceneDepth < 0.999999) {
      vec4 clipPosition = vec4(screenUv * 2.0 - 1.0, sceneDepth * 2.0 - 1.0, 1.0);
      vec4 viewPosition = uInvProjection * clipPosition;
      viewPosition /= max(0.00001, viewPosition.w);
      vec3 sceneWorld = (uCameraWorld * viewPosition).xyz;
      vec3 sceneLocal = (uWorldToLocal * vec4(sceneWorld, 1.0)).xyz;
      float sceneDistance = dot(sceneLocal - uCameraLocal, rayDirection);
      if (sceneDistance > 0.0) endDistance = min(endDistance, sceneDistance);
    }
    if (endDistance <= startDistance) discard;

    float baseStep = (endDistance - startDistance) / max(uStepCount, 1.0);
    float sampleDistance = startDistance + baseStep * uJitter;
    float transmittance = 1.0;
    vec3 accumulatedLight = vec3(0.0);
    vec3 sunLocal = normalize(uSunDirection);
    float cosTheta = dot(rayDirection, sunLocal);

    for (int stepIndex = 0; stepIndex < 96; stepIndex += 1) {
      if (sampleDistance > endDistance || transmittance < 0.018) break;
      vec3 samplePosition = uCameraLocal + rayDirection * sampleDistance;
      float density = densityField(samplePosition);
      float occupancy = smoothstep(0.004, 0.075, density);
      float adaptiveStep = mix(baseStep * 2.15, baseStep * 0.68, occupancy);

      if (density > 0.003) {
        float height = samplePosition.y * 0.5 + 0.5;
        float directLight = lightEnergy(samplePosition, sunLocal, cosTheta);
        float stormMaturity = smoothstep(0.55, 0.86, uDevelopment);
        float storminess = saturate(max(uPrecipitation * 1.08, uOrganization * uEventIntensity * stormMaturity * 0.92));
        float fairCumulus = 1.0 - smoothstep(0.22, 0.54, max(uDevelopment, storminess));
        vec3 fairBase = mix(vec3(0.76, 0.78, 0.78), vec3(0.64, 0.67, 0.7), smoothstep(0.0, 0.28, uDevelopment));
        vec3 stormBase = mix(fairBase, vec3(0.075, 0.085, 0.11), storminess);
        vec3 upperCloud = mix(vec3(0.985, 0.99, 0.985), vec3(0.48, 0.53, 0.6), storminess);
        vec3 albedo = mix(stormBase, upperCloud, smoothstep(0.07, 0.92, height));
        float sunRim = pow(max(cosTheta, 0.0), 5.0) * (0.2 + height * 0.55) * uDayFactor;
        float ambient = mix(0.58, 0.82, height) * mix(0.64, 1.0, uDayFactor);
        ambient += fairCumulus * 0.18 * uDayFactor;
        vec3 radiance = albedo * (ambient + directLight * mix(0.34, 1.02, uDayFactor) * (1.0 - fairCumulus * 0.22));
        radiance += upperCloud * sunRim * (1.0 - storminess * 0.35);
        float lightning = 0.0;
        for (int flashIndex = 0; flashIndex < 4; flashIndex += 1) {
          vec4 flash = uLightningFlashes[flashIndex];
          vec3 worldDelta = (samplePosition - flash.xyz) * uVolumeHalfSize;
          float lightningDistance = length(worldDelta) / max(1.0, uLightningRadii[flashIndex]);
          lightning += flash.w * exp(-lightningDistance * lightningDistance * 2.8);
        }
        radiance += vec3(0.62, 0.76, 1.0) * lightning * (1.4 + density * 2.2);

        float sampleAlpha = 1.0 - exp(-density * adaptiveStep * 6.2 * uOpacity);
        accumulatedLight += transmittance * radiance * sampleAlpha;
        transmittance *= 1.0 - sampleAlpha;
      }
      sampleDistance += adaptiveStep;
    }

    float alpha = 1.0 - transmittance;
    if (alpha < 0.004) discard;
    if (uDebugDensity > 0.5) {
      fragColor = vec4(vec3(alpha), alpha);
      return;
    }
    fragColor = vec4(accumulatedLight / max(alpha, 0.001), alpha);
  }
`;
