plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.aethersense"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.aethersense"
        minSdk = 34
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0-mvp"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

dependencies {
    implementation("org.java-websocket:Java-WebSocket:1.5.7")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
