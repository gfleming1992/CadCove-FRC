// Selected real component models, separate from the example chassis geometry.
// DCMotor.getKrakenX60(1), WPILib 2026.2.1, non-FOC nominal motor data:
// https://github.com/wpilibsuite/allwpilib/blob/v2026.2.1/wpimath/src/main/java/edu/wpi/first/math/system/plant/DCMotor.java
// Robot.java independently checks these derived constants against that API.
const nominalVoltage=12,stallCurrent=366,stallTorque=7.09,freeCurrent=2;
const resistance=nominalVoltage/stallCurrent;
export const krakenX60={
 model:'KrakenX60',resistance,torque_constant:stallTorque/stallCurrent,
 velocity_constant:(6000*2*Math.PI/60)/(nominalVoltage-resistance*freeCurrent),
 current_limit:40,
};
// LL3G manufacturer's 80 x 56 degree, 1280 x 800 sensor configuration:
// https://limelightvision.io/products/limelight-3g
// 30 FPS, 40 ms latency and noise below are chosen simulation assumptions,
// not claimed capture/processing measurements or the camera's maximum rate.
export const limelight={
 name:'limelight-front',body:'chassis',position:[.32,0,.35],rotationDegrees:[0,0,0],
 horizontalFovDegrees:80,verticalFovDegrees:56,widthPixels:1280,heightPixels:800,
 framesPerSecond:30,latencyMs:40,xyStdDevAt2m:.02,yawStdDevDegreesAt2m:1.5,
 maxDistanceMetres:6,minEdgePixels:8,maxIncidenceDegrees:75,
};
